import { severitySchema } from '@smokejumper/plugin-sdk'
import { SPECIALIST_NAMES, type ModelDriver } from './driver'
import { exampleFromSchema } from './example-from-schema'

export function createFakeDriver(): ModelDriver {
  return {
    async triage(input) {
      const severity = severitySchema.safeParse(input.severity)
      return {
        severity: severity.success ? severity.data : 'medium',
        affectedService: input.service,
        brief: `Fake triage: ${input.title} affecting ${input.service}`,
        questions: ['What changed before the alert fired?', 'Is the failure isolated to one service?'],
      }
    },
    async plan(input) {
      const toolNames = input.inventory.map((tool) => tool.name)
      return {
        specialists: SPECIALIST_NAMES.map((name) => ({
          name,
          toolNames,
          objective: `Gather ${name} signals for ${input.triage.affectedService}`,
        })),
      }
    },
    async runSpecialist(input, tools, opts) {
      if (opts.signal.aborted) {
        throw opts.signal.reason instanceof Error ? opts.signal.reason : new Error('specialist aborted')
      }
      const tool = tools[0]
      if (!tool) {
        return { summary: `${input.name}: no tools available — manual investigation required`, evidenceIds: [] }
      }
      const call = await tool.call(exampleFromSchema(tool.inputSchema))
      return { summary: `${input.name}: ${tool.name} → ${call.summary}`, evidenceIds: [call.evidenceId] }
    },
    async synthesize(input) {
      return {
        rootCause: `Fake diagnosis based on triage: ${input.brief}`,
        confidence: 0.5,
        evidenceChain: input.findings
          .filter((finding) => finding.evidenceIds.length > 0)
          .map((finding) => ({ claim: finding.summary, evidenceIds: finding.evidenceIds })),
        remediation: 'Review the cited evidence and confirm the suspected cause manually.',
        openQuestions: ['Confirm the fake diagnosis against the real telemetry.'],
      }
    },
  }
}
