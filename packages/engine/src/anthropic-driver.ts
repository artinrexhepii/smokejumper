import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { EngineModels } from './config'
import {
  planResultSchema,
  reviewResultSchema,
  specialistResultSchema,
  synthesisResultSchema,
  triageResultSchema,
  type DriverTool,
  type ModelDriver,
  type PlanInput,
  type ReviewInput,
  type SpecialistInput,
  type SynthesisInput,
  type TriageInput,
} from './driver'

const TRIAGE_INSTRUCTIONS = `You are the triage officer for a production incident.
Confirm or adjust the reported severity, identify the affected service, and write a
short investigation brief: the concrete questions an on-call engineer must answer.
Be terse and factual. Do not speculate beyond the alert data.`

const PLAN_INSTRUCTIONS = `You are the lead investigator for a production incident.
Given a triage brief and an inventory of read-only telemetry tools, decide which
specialists to dispatch and which tools each may use. Only reference tool names that
appear in the inventory, exactly as written. Prefer cheap, low-latency tools first.
Skip specialists that have no relevant tools.`

const SPECIALIST_ROLES: Record<SpecialistInput['name'], string> = {
  'log-analyst': 'You analyze application and container logs for errors, stack traces, and anomalies.',
  'metrics-analyst': 'You analyze service health signals: error rates, latency, saturation, resource usage.',
  'change-correlator': 'You correlate the incident with recent deploys, commits, and configuration changes.',
}

const SPECIALIST_INSTRUCTIONS = `Investigate using ONLY the tools provided. Every tool
result includes an evidenceId — collect the ids of results that support your conclusions
and return them in evidenceIds. If a tool fails, note the absence of that signal and move
on; a failed tool is itself a finding. Never invent evidence ids.`

const SYNTHESIS_INSTRUCTIONS = `You are the synthesis lead for a production incident.
Cross-examine the specialists' findings and produce a diagnosis. Every claim in
evidenceChain must cite the evidenceIds that support it. Anything you cannot support
with evidence belongs in openQuestions or must be phrased as an unverified hypothesis.
confidence is a number between 0 and 1.`

const REVIEW_INSTRUCTIONS = `You are writing a post-incident review (postmortem) for a
resolved production incident. Produce a clear summary, an ordered timeline grounded only
in the evidence provided, a root cause, contributing factors, and concrete action items.
Every entry in evidenceRefs must be one of the evidence ids provided — never invent an id.
If no diagnosis is available, say so plainly in rootCause rather than speculating.`

function anthropicModel(id: string): string {
  return `anthropic/${id}`
}

function renderTriagePrompt(input: TriageInput): string {
  return [
    `Alert title: ${input.title}`,
    `Reported severity: ${input.severity}`,
    `Service: ${input.service}`,
    `Labels: ${JSON.stringify(input.labels)}`,
    'Produce the triage assessment.',
  ].join('\n')
}

function renderPlanPrompt(input: PlanInput): string {
  const inventory = input.inventory
    .map((tool) => `- ${tool.name} (${tool.costHint}, ~${tool.latencyHintMs}ms): ${tool.description}`)
    .join('\n')
  return [
    `Investigation brief: ${input.triage.brief}`,
    `Open questions:\n${input.triage.questions.map((q) => `- ${q}`).join('\n')}`,
    `Available tools:\n${inventory || '(none configured)'}`,
    'Draft the investigation plan.',
  ].join('\n\n')
}

function renderSpecialistPrompt(input: SpecialistInput): string {
  return [
    `Investigation brief: ${input.brief}`,
    `Your objective: ${input.objective}`,
    'Investigate now and report your findings.',
  ].join('\n')
}

export function renderSynthesisPrompt(input: SynthesisInput): string {
  const findings = input.findings
    .map((f) => `- [${f.specialist}] ${f.summary} (evidence: ${f.evidenceIds.join(', ') || 'none'})`)
    .join('\n')
  const evidence = input.evidence.map((e) => `- ${e.id} (${e.toolName}): ${e.summary}`).join('\n')
  const past = input.pastIncidents
    .map((p) => `- (similarity ${p.similarity.toFixed(2)}) ${p.content}`)
    .join('\n')
  const runbooks = (input.runbooks ?? [])
    .map((r) => `- (similarity ${r.similarity.toFixed(2)}) [${r.title}] ${r.content}`)
    .join('\n')
  return [
    `Investigation brief: ${input.brief}`,
    `Specialist findings:\n${findings || '(none)'}`,
    `Evidence records:\n${evidence || '(none)'}`,
    past ? `Similar past incidents:\n${past}` : 'No similar past incidents on record.',
    runbooks
      ? `Relevant runbook passages (advisory context only — cite via search_runbooks to make a claim evidence-backed):\n${runbooks}`
      : 'No relevant runbook passages found.',
    'Produce the diagnosis.',
  ].join('\n\n')
}

function renderReviewPrompt(input: ReviewInput): string {
  const diagnosis = input.diagnosis
    ? [
        `Root cause: ${input.diagnosis.rootCause}`,
        `Confidence: ${input.diagnosis.confidence}`,
        `Remediation: ${input.diagnosis.remediation}`,
        `Open questions:\n${input.diagnosis.openQuestions.map((q) => `- ${q}`).join('\n') || '(none)'}`,
      ].join('\n')
    : 'No diagnosis was reached.'
  const findings = input.findings.map((f) => `- [${f.specialist}] ${f.summary}`).join('\n')
  const evidence = input.evidence.map((e) => `- ${e.id} (${e.toolName}): ${e.summary}`).join('\n')
  return [
    `Incident: ${input.incident.title} (severity ${input.incident.severity}, service ${input.incident.service})`,
    `Diagnosis:\n${diagnosis}`,
    `Findings:\n${findings || '(none)'}`,
    `Ordered evidence chain:\n${evidence || '(none)'}`,
    'Write the post-incident review.',
  ].join('\n\n')
}

const recordedToolOutputSchema = z.object({
  evidenceId: z.string(),
  summary: z.string(),
  failed: z.boolean(),
  data: z.string(),
})

function truncate(value: string, max = 2_000): string {
  return value.length <= max ? value : `${value.slice(0, max)}…[truncated]`
}

function toMastraTools(tools: DriverTool[]) {
  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      createTool({
        id: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: recordedToolOutputSchema,
        execute: async (inputData) => {
          const call = await tool.call(inputData)
          return {
            evidenceId: call.evidenceId,
            summary: call.summary,
            failed: call.failed,
            data: truncate(JSON.stringify(call.data ?? null)),
          }
        },
      }),
    ]),
  )
}

export function createAnthropicDriver(models: EngineModels): ModelDriver {
  return {
    async triage(input, opts) {
      const agent = new Agent({
        id: 'smokejumper-triage',
        name: 'Smokejumper Triage',
        instructions: TRIAGE_INSTRUCTIONS,
        model: anthropicModel(models.triage),
      })
      const result = await agent.generate(renderTriagePrompt(input), {
        abortSignal: opts.signal,
        structuredOutput: { schema: triageResultSchema },
      })
      return triageResultSchema.parse(result.object)
    },
    async plan(input, opts) {
      const agent = new Agent({
        id: 'smokejumper-planner',
        name: 'Smokejumper Planner',
        instructions: PLAN_INSTRUCTIONS,
        model: anthropicModel(models.investigator),
      })
      const result = await agent.generate(renderPlanPrompt(input), {
        abortSignal: opts.signal,
        structuredOutput: { schema: planResultSchema },
      })
      return planResultSchema.parse(result.object)
    },
    async runSpecialist(input, tools, opts) {
      const agent = new Agent({
        id: `smokejumper-${input.name}`,
        name: `Smokejumper ${input.name}`,
        instructions: `${SPECIALIST_ROLES[input.name]}\n${SPECIALIST_INSTRUCTIONS}`,
        model: anthropicModel(models.investigator),
        tools: toMastraTools(tools),
      })
      const result = await agent.generate(renderSpecialistPrompt(input), {
        maxSteps: 6,
        abortSignal: opts.signal,
        structuredOutput: {
          schema: specialistResultSchema,
          model: anthropicModel(models.investigator),
        },
      })
      return specialistResultSchema.parse(result.object)
    },
    async synthesize(input) {
      const agent = new Agent({
        id: 'smokejumper-synthesis',
        name: 'Smokejumper Synthesis',
        instructions: SYNTHESIS_INSTRUCTIONS,
        model: anthropicModel(models.synthesis),
      })
      const result = await agent.generate(renderSynthesisPrompt(input), {
        structuredOutput: { schema: synthesisResultSchema },
      })
      return synthesisResultSchema.parse(result.object)
    },
    async draftReview(input, opts) {
      const agent = new Agent({
        id: 'smokejumper-review',
        name: 'Smokejumper Review',
        instructions: REVIEW_INSTRUCTIONS,
        model: anthropicModel(models.synthesis),
      })
      const result = await agent.generate(renderReviewPrompt(input), {
        abortSignal: opts?.signal,
        structuredOutput: { schema: reviewResultSchema },
      })
      return reviewResultSchema.parse(result.object)
    },
  }
}
