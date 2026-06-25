import { describe, expect, it } from 'vitest'
import type { IncidentEvent } from '../src/lib/api'
import { initialTraceState, traceReducer, type TraceState } from '../src/lib/trace'

function event(overrides: Partial<IncidentEvent> = {}): IncidentEvent {
  return {
    type: 'investigation.milestone',
    incidentId: 'inc-1',
    projectId: 'proj-1',
    occurredAt: '2026-07-04T10:00:00.000Z',
    payload: {},
    ...overrides,
  }
}

function apply(events: IncidentEvent[], initial: TraceState = initialTraceState): TraceState {
  return events.reduce((state, e) => traceReducer(state, { type: 'event', event: e }), initial)
}

describe('traceReducer', () => {
  it('appends events as ordered steps', () => {
    const state = apply([
      event({ type: 'investigation.started', occurredAt: '2026-07-04T10:00:00.000Z' }),
      event({ occurredAt: '2026-07-04T10:00:05.000Z', payload: { phase: 'triage' } }),
    ])
    expect(state.steps.map((s) => s.title)).toEqual(['Investigation started', 'Milestone — triage'])
  })

  it('inserts late-arriving earlier events into position', () => {
    const state = apply([
      event({ occurredAt: '2026-07-04T10:00:10.000Z', payload: { phase: 'synthesis' } }),
      event({ occurredAt: '2026-07-04T10:00:01.000Z', payload: { phase: 'triage' } }),
    ])
    expect(state.steps.map((s) => s.title)).toEqual(['Milestone — triage', 'Milestone — synthesis'])
  })

  it('keeps arrival order for identical timestamps', () => {
    const state = apply([
      event({ payload: { phase: 'logs' } }),
      event({ payload: { phase: 'metrics' } }),
    ])
    expect(state.steps.map((s) => s.title)).toEqual(['Milestone — logs', 'Milestone — metrics'])
  })

  it('drops exact duplicate events', () => {
    const e = event({ payload: { phase: 'triage' } })
    const state = apply([e, e])
    expect(state.steps).toHaveLength(1)
  })

  it('keeps same-timestamp events whose payloads differ', () => {
    const state = apply([
      event({ payload: { phase: 'logs' } }),
      event({ payload: { phase: 'deploys' } }),
    ])
    expect(state.steps).toHaveLength(2)
  })

  it('titles known event types', () => {
    const state = apply([
      event({ type: 'incident.opened', occurredAt: '2026-07-04T10:00:00.000Z' }),
      event({ type: 'diagnosis.ready', occurredAt: '2026-07-04T10:00:01.000Z' }),
      event({ type: 'incident.resolved', occurredAt: '2026-07-04T10:00:02.000Z' }),
    ])
    expect(state.steps.map((s) => s.title)).toEqual([
      'Incident opened',
      'Diagnosis ready',
      'Incident resolved',
    ])
  })

  it('extracts detail from payload.message', () => {
    const state = apply([event({ payload: { phase: 'triage', message: 'severity high, service api' } })])
    expect(state.steps[0]!.detail).toBe('severity high, service api')
  })

  it('collects only string evidence ids', () => {
    const state = apply([event({ payload: { evidenceIds: ['ev-1', 42, 'ev-2'] } })])
    expect(state.steps[0]!.evidenceIds).toEqual(['ev-1', 'ev-2'])
  })

  it('tolerates unknown event types', () => {
    const state = apply([{ ...event(), type: 'investigation.retrying' as never }])
    expect(state.steps[0]!.title).toBe('investigation.retrying')
  })

  it('tolerates a malformed payload', () => {
    const state = apply([{ ...event(), payload: null as never }])
    expect(state.steps[0]!.evidenceIds).toEqual([])
    expect(state.steps[0]!.detail).toBeUndefined()
  })

  it('reset clears the timeline', () => {
    const filled = apply([event()])
    expect(traceReducer(filled, { type: 'reset' }).steps).toEqual([])
  })
})
