import { describe, expect, it } from 'vitest'
import type { IncidentEvent } from '@smokejumper/plugin-sdk'
import { renderEvent } from '../src/render'

function event(type: IncidentEvent['type'], payload: Record<string, unknown> = {}): IncidentEvent {
  return { type, incidentId: 'inc-1', projectId: 'proj-1', occurredAt: '2026-07-04T10:00:00.000Z', payload }
}

describe('renderEvent', () => {
  it('renders incident.opened with title, severity, and service', () => {
    const r = renderEvent(
      event('incident.opened', { title: 'shop-api: error rate spike', severity: 'high', service: 'shop-api' }),
    )
    expect(r.title).toBe('Incident: shop-api: error rate spike')
    expect(r.markdown).toContain('**Severity:** high')
    expect(r.markdown).toContain('**Service:** shop-api')
  })

  it('renders investigation.started', () => {
    const r = renderEvent(event('investigation.started'))
    expect(r.title).toBe('Investigation started')
    expect(r.markdown).toContain('inc-1')
  })

  it('renders investigation.milestone with phase and summary', () => {
    const r = renderEvent(event('investigation.milestone', { phase: 'triage', summary: 'High severity, shop-api affected' }))
    expect(r.title).toBe('Investigation update: triage')
    expect(r.markdown).toBe('High severity, shop-api affected')
  })

  it('renders diagnosis.ready with root cause, confidence, and remediation', () => {
    const r = renderEvent(
      event('diagnosis.ready', { rootCause: 'OOM in worker', confidence: 0.85, remediation: 'raise the memory limit' }),
    )
    expect(r.title).toBe('Diagnosis ready')
    expect(r.markdown).toContain('**Root cause:** OOM in worker')
    expect(r.markdown).toContain('**Confidence:** 85%')
    expect(r.markdown).toContain('**Suggested remediation:** raise the memory limit')
  })

  it('renders incident.resolved', () => {
    const r = renderEvent(event('incident.resolved'))
    expect(r.title).toBe('Incident resolved')
    expect(r.markdown).toContain('inc-1')
  })

  it('falls back gracefully on missing payload fields', () => {
    expect(renderEvent(event('incident.opened')).title).toBe('Incident: new incident')
    expect(renderEvent(event('diagnosis.ready')).markdown).toContain('**Confidence:** unknown')
  })
})
