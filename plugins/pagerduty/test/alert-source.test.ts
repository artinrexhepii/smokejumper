import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkAlertSource, type NormalizedAlert } from '@smokejumper/plugin-sdk'
import { createPagerdutyAlertSource } from '../src/index'
import { pagerdutyResolvedWebhook, pagerdutyTriggeredWebhook } from './fixtures/webhook'

const source = createPagerdutyAlertSource()
const secret = 'pd-signing-secret'
const config = { signingSecret: secret }
const rawBody = JSON.stringify(pagerdutyTriggeredWebhook)

function sign(body: string, key: string): string {
  return createHmac('sha256', key).update(body, 'utf8').digest('hex')
}

describe('pagerduty alert source', () => {
  it('passes conformance', async () => {
    const result = await checkAlertSource(source, {
      config,
      validRequest: { headers: { 'x-pagerduty-signature': `v1=${sign(rawBody, secret)}` }, body: pagerdutyTriggeredWebhook, rawBody },
      invalidRequest: { headers: { 'x-pagerduty-signature': `v1=${sign(rawBody, 'wrong-secret')}` }, body: pagerdutyTriggeredWebhook, rawBody },
      samplePayloads: [pagerdutyTriggeredWebhook],
    })
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('accepts any request when no signing secret is configured', async () => {
    expect(await source.verify({ headers: {}, body: pagerdutyTriggeredWebhook, rawBody }, {})).toBe(true)
  })

  it('rejects a missing signature header when a signing secret is configured', async () => {
    expect(await source.verify({ headers: {}, body: pagerdutyTriggeredWebhook, rawBody }, config)).toBe(false)
  })

  it('rejects a signature computed with the wrong secret', async () => {
    const badHeader = `v1=${sign(rawBody, 'wrong-secret')}`
    expect(
      await source.verify({ headers: { 'x-pagerduty-signature': badHeader }, body: pagerdutyTriggeredWebhook, rawBody }, config),
    ).toBe(false)
  })

  it('rejects a malformed signature header without throwing', async () => {
    expect(
      await source.verify(
        { headers: { 'x-pagerduty-signature': 'not-a-valid-signature' }, body: pagerdutyTriggeredWebhook, rawBody },
        config,
      ),
    ).toBe(false)
  })

  it('accepts a matching signature among multiple comma-separated values (secret rotation)', async () => {
    const header = `v1=${sign(rawBody, 'old-secret')},v1=${sign(rawBody, secret)}`
    expect(await source.verify({ headers: { 'x-pagerduty-signature': header }, body: pagerdutyTriggeredWebhook, rawBody }, config)).toBe(
      true,
    )
  })

  it('normalizes a triggered incident event', () => {
    const alerts = source.normalize(pagerdutyTriggeredWebhook, config)
    const list = Array.isArray(alerts) ? alerts : [alerts]
    expect(list).toHaveLength(1)
    const alert = list[0]!
    expect(alert.title).toBe('shop-api error rate above threshold')
    expect(alert.service).toBe('shop-api')
    expect(alert.severity).toBe('critical')
    expect(alert.dedupKey).toBe('baf7cf21b1da41b4b0221008339ff357')
    expect(alert.occurredAt).toBe('2026-07-06T09:00:00.000Z')
    expect(alert.labels).toEqual({ status: 'triggered', urgency: 'high', incidentNumber: '12' })
  })

  it('skips resolved incident events', () => {
    const alerts = source.normalize(pagerdutyResolvedWebhook, config)
    expect(Array.isArray(alerts) ? alerts : [alerts]).toEqual([])
  })

  it('maps pagerduty priority onto smokejumper severities', () => {
    const withPriority = (summary: string) => ({
      ...pagerdutyTriggeredWebhook,
      event: { ...pagerdutyTriggeredWebhook.event, data: { ...pagerdutyTriggeredWebhook.event.data, priority: { summary } } },
    })
    const severityOf = (summary: string) => {
      const alerts = source.normalize(withPriority(summary), config)
      return (Array.isArray(alerts) ? alerts : [alerts])[0]!.severity
    }
    expect(severityOf('P1')).toBe('critical')
    expect(severityOf('P2')).toBe('high')
    expect(severityOf('P3')).toBe('medium')
    expect(severityOf('P4')).toBe('low')
    expect(severityOf('P5')).toBe('info')
  })

  it('falls back to urgency when no priority is set', () => {
    const withUrgency = (urgency: 'high' | 'low') => ({
      ...pagerdutyTriggeredWebhook,
      event: {
        ...pagerdutyTriggeredWebhook.event,
        data: { ...pagerdutyTriggeredWebhook.event.data, priority: null, urgency },
      },
    })
    const severityOf = (urgency: 'high' | 'low') => {
      const alerts = source.normalize(withUrgency(urgency), config)
      return (Array.isArray(alerts) ? alerts : [alerts])[0]!.severity
    }
    expect(severityOf('high')).toBe('high')
    expect(severityOf('low')).toBe('low')
  })

  it('defaults to medium severity with no priority and no urgency', () => {
    const minimal = {
      event: {
        event_type: 'incident.triggered',
        occurred_at: '2026-07-06T09:05:00.000Z',
        data: { id: 'PGR0VU9', title: 'NodeDown' },
      },
    }
    const alerts = source.normalize(minimal, config)
    const list = (Array.isArray(alerts) ? alerts : [alerts]) as NormalizedAlert[]
    expect(list[0]!.severity).toBe('medium')
  })

  it('falls back to the incident id when incident_key is absent', () => {
    const noIncidentKey = {
      ...pagerdutyTriggeredWebhook,
      event: {
        ...pagerdutyTriggeredWebhook.event,
        data: { ...pagerdutyTriggeredWebhook.event.data, incident_key: undefined },
      },
    }
    const alerts = source.normalize(noIncidentKey, config)
    expect((Array.isArray(alerts) ? alerts : [alerts])[0]!.dedupKey).toBe('PGR0VU2')
  })

  it('throws on a payload missing the event data', () => {
    expect(() => source.normalize({ event: { event_type: 'incident.triggered' } }, config)).toThrow()
  })
})
