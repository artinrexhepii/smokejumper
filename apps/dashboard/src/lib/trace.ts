import type { IncidentEvent } from './api'

export interface TraceStep {
  key: string
  type: string
  occurredAt: string
  title: string
  detail?: string
  evidenceIds: string[]
  payload: Record<string, unknown>
}

export interface TraceState {
  steps: TraceStep[]
}

export const initialTraceState: TraceState = { steps: [] }

export type TraceAction = { type: 'event'; event: IncidentEvent } | { type: 'reset' }

const titles: Record<string, string> = {
  'incident.opened': 'Incident opened',
  'investigation.started': 'Investigation started',
  'investigation.milestone': 'Milestone',
  'diagnosis.ready': 'Diagnosis ready',
  'incident.resolved': 'Incident resolved',
}

function stepTitle(type: string, payload: Record<string, unknown>): string {
  if (type === 'investigation.milestone' && typeof payload.phase === 'string') {
    return `Milestone — ${payload.phase}`
  }
  return titles[type] ?? type
}

function stepDetail(payload: Record<string, unknown>): string | undefined {
  for (const key of ['message', 'summary', 'detail']) {
    const value = payload[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function stepEvidenceIds(payload: Record<string, unknown>): string[] {
  const ids = payload.evidenceIds
  if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === 'string')
  return []
}

export function eventKey(event: IncidentEvent): string {
  return `${event.type}|${event.occurredAt}|${JSON.stringify(event.payload ?? {})}`
}

export function traceReducer(state: TraceState, action: TraceAction): TraceState {
  if (action.type === 'reset') return initialTraceState
  const event = action.event
  if (!event || typeof event.type !== 'string') return state
  const key = eventKey(event)
  if (state.steps.some((step) => step.key === key)) return state
  const payload = (
    event.payload && typeof event.payload === 'object' ? event.payload : {}
  ) as Record<string, unknown>
  const step: TraceStep = {
    key,
    type: event.type,
    occurredAt: typeof event.occurredAt === 'string' ? event.occurredAt : new Date(0).toISOString(),
    title: stepTitle(event.type, payload),
    detail: stepDetail(payload),
    evidenceIds: stepEvidenceIds(payload),
    payload,
  }
  const steps = [...state.steps]
  let i = steps.length
  while (i > 0 && steps[i - 1]!.occurredAt > step.occurredAt) i--
  steps.splice(i, 0, step)
  return { steps }
}
