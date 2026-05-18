import type { NormalizedAlert } from './alert'
import type { SinkContext, SourceContext } from './context'
import type { PluginManifest } from './manifest'
import type { ToolSpec } from './tool'

export interface AlertSourceRequest {
  headers: Record<string, string>
  body: unknown
  rawBody: string
}

export interface AlertSource<TConfig = unknown> {
  manifest: PluginManifest
  verify(req: AlertSourceRequest, config: TConfig): Promise<boolean>
  normalize(payload: unknown, config: TConfig): NormalizedAlert | NormalizedAlert[]
}

export interface SourceHealth {
  ok: boolean
  message?: string
}

export interface TelemetrySource<TConfig = unknown> {
  manifest: PluginManifest
  healthCheck(ctx: SourceContext<TConfig>): Promise<SourceHealth>
  tools(): ToolSpec<TConfig>[]
}

export interface ContextChunk {
  text: string
  source: string
  url?: string
  score?: number
}

export interface ContextSource<TConfig = unknown> {
  manifest: PluginManifest
  search(query: string, scope: { projectId: string }, ctx: SourceContext<TConfig>): Promise<ContextChunk[]>
}

export type IncidentEventType =
  | 'incident.opened'
  | 'investigation.started'
  | 'investigation.milestone'
  | 'diagnosis.ready'
  | 'incident.resolved'

export interface IncidentEvent {
  type: IncidentEventType
  incidentId: string
  projectId: string
  occurredAt: string
  payload: Record<string, unknown>
}

export interface Rendering {
  title: string
  markdown: string
  url?: string
}

export interface DeliveryReceipt {
  delivered: boolean
  externalId?: string
  error?: string
}

export interface NotificationSink<TConfig = unknown> {
  manifest: PluginManifest
  notify(event: IncidentEvent, rendering: Rendering, ctx: SinkContext<TConfig>): Promise<DeliveryReceipt>
}

export interface ActionRequest {
  kind: string
  params: Record<string, unknown>
}

export interface ActionPlan {
  description: string
  steps: string[]
  risk: 'low' | 'medium' | 'high'
}

export interface ActionApproval {
  approvedBy: string
  approvedAt: string
}

export interface ActionResult {
  ok: boolean
  detail: string
}

// Defined for SDK stability; the host does not load action sinks until the autonomy phase.
export interface ActionSink<TConfig = unknown> {
  manifest: PluginManifest
  plan(action: ActionRequest, ctx: SinkContext<TConfig>): Promise<ActionPlan>
  execute(plan: ActionPlan, approval: ActionApproval, ctx: SinkContext<TConfig>): Promise<ActionResult>
}
