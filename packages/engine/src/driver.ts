import { severitySchema, type CostHint } from '@smokejumper/plugin-sdk'
import { z } from 'zod'

export const SPECIALIST_NAMES = ['log-analyst', 'metrics-analyst', 'change-correlator'] as const

export const specialistNameSchema = z.enum(SPECIALIST_NAMES)

export type SpecialistName = z.infer<typeof specialistNameSchema>

export const triageResultSchema = z.object({
  severity: severitySchema,
  affectedService: z.string(),
  brief: z.string(),
  questions: z.array(z.string()),
})

export type TriageResult = z.infer<typeof triageResultSchema>

export const planResultSchema = z.object({
  specialists: z.array(
    z.object({
      name: specialistNameSchema,
      toolNames: z.array(z.string()),
      objective: z.string(),
    }),
  ),
})

export type PlanResult = z.infer<typeof planResultSchema>

export const specialistResultSchema = z.object({
  summary: z.string(),
  evidenceIds: z.array(z.string()),
})

export type SpecialistResult = z.infer<typeof specialistResultSchema>

export const synthesisResultSchema = z.object({
  rootCause: z.string(),
  confidence: z.number().min(0).max(1),
  evidenceChain: z.array(z.object({ claim: z.string(), evidenceIds: z.array(z.string()) })),
  remediation: z.string(),
  openQuestions: z.array(z.string()),
})

export type SynthesisResult = z.infer<typeof synthesisResultSchema>

export interface TriageInput {
  title: string
  severity: string
  service: string
  labels: Record<string, string>
}

export interface ToolInventoryItem {
  name: string
  description: string
  costHint: CostHint
  latencyHintMs: number
}

export interface PlanInput {
  triage: TriageResult
  inventory: ToolInventoryItem[]
}

export interface RecordedToolCall {
  evidenceId: string
  summary: string
  data: unknown
  failed: boolean
}

export interface DriverTool {
  name: string
  description: string
  inputSchema: z.ZodTypeAny
  call(input: unknown): Promise<RecordedToolCall>
}

export interface SpecialistInput {
  name: SpecialistName
  objective: string
  brief: string
}

export interface SynthesisInput {
  brief: string
  findings: Array<{ specialist: string; summary: string; evidenceIds: string[] }>
  evidence: Array<{ id: string; toolName: string; summary: string }>
  pastIncidents: Array<{ content: string; similarity: number }>
  runbooks?: Array<{ content: string; similarity: number; title: string }>
}

export interface ReviewInput {
  incident: { title: string; severity: string; service: string }
  diagnosis?: { rootCause: string; confidence: number; remediation: string; openQuestions: string[] }
  findings: Array<{ specialist: string; summary: string; evidenceIds: string[] }>
  evidence: Array<{ id: string; toolName: string; summary: string }>
}

export const reviewResultSchema = z.object({
  summary: z.string(),
  timeline: z.array(z.object({ at: z.string(), text: z.string() })),
  rootCause: z.string(),
  contributingFactors: z.array(z.string()),
  actionItems: z.array(z.string()),
  evidenceRefs: z.array(z.string()),
})

export type ReviewResult = z.infer<typeof reviewResultSchema>

export interface DriverCallOptions {
  signal: AbortSignal
}

export interface ModelDriver {
  triage(input: TriageInput, opts: DriverCallOptions): Promise<TriageResult>
  plan(input: PlanInput, opts: DriverCallOptions): Promise<PlanResult>
  runSpecialist(input: SpecialistInput, tools: DriverTool[], opts: DriverCallOptions): Promise<SpecialistResult>
  synthesize(input: SynthesisInput): Promise<SynthesisResult>
  draftReview(input: ReviewInput, opts?: DriverCallOptions): Promise<ReviewResult>
}
