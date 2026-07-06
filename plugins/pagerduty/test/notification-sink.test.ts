import { describe, expect, it } from 'vitest'
import { checkNotificationSink, type IncidentEvent, type SinkContext } from '@smokejumper/plugin-sdk'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createPagerdutyNotificationSink, type PagerdutyNotifyConfig } from '../src/index'

const sink = createPagerdutyNotificationSink()
const config: PagerdutyNotifyConfig = { routingKey: 'r0ut1ng-key-2026' }

interface CapturedRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

function pagerdutyContext(response: () => Response) {
  const requests: CapturedRequest[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return response()
  }) as typeof fetch
  const ctx: SinkContext<PagerdutyNotifyConfig> = { ...createTestContext(config), fetch: fetchImpl }
  return { ctx, requests }
}

const openedEvent: IncidentEvent = {
  type: 'incident.opened',
  incidentId: 'inc-1',
  projectId: 'proj-1',
  occurredAt: '2026-07-06T09:00:00.000Z',
  payload: { title: 'shop-api errors spiking', severity: 'critical', service: 'shop-api' },
}

const resolvedEvent: IncidentEvent = {
  type: 'incident.resolved',
  incidentId: 'inc-1',
  projectId: 'proj-1',
  occurredAt: '2026-07-06T09:30:00.000Z',
  payload: {},
}

describe('pagerduty notification sink', () => {
  it('passes conformance', async () => {
    const { ctx } = pagerdutyContext(() => Response.json({ status: 'success', message: 'Event processed', dedup_key: 'conformance-incident' }))
    const result = await checkNotificationSink(sink, ctx)
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('triggers a pagerduty event on incident open with the routing key and mapped severity', async () => {
    const { ctx, requests } = pagerdutyContext(() => Response.json({ status: 'success', message: 'Event processed', dedup_key: 'inc-1' }))
    const receipt = await sink.notify(openedEvent, { title: 'Incident: shop-api errors spiking', markdown: '**Severity:** critical' }, ctx)
    expect(receipt).toEqual({ delivered: true, externalId: 'inc-1' })
    expect(requests[0]!.url).toBe('https://events.pagerduty.com/v2/enqueue')
    expect(requests[0]!.body).toMatchObject({
      routing_key: 'r0ut1ng-key-2026',
      event_action: 'trigger',
      dedup_key: 'inc-1',
      client: 'Smokejumper',
      payload: {
        summary: 'Incident: shop-api errors spiking',
        source: 'smokejumper',
        severity: 'critical',
        timestamp: '2026-07-06T09:00:00.000Z',
      },
    })
  })

  it('maps smokejumper severities onto pagerduty event severities', async () => {
    const severityOf = async (severity: string) => {
      const { ctx, requests } = pagerdutyContext(() => Response.json({ status: 'success', dedup_key: 'inc-1' }))
      const event: IncidentEvent = { ...openedEvent, payload: { ...openedEvent.payload, severity } }
      await sink.notify(event, { title: 'T', markdown: 'm' }, ctx)
      return (requests[0]!.body.payload as { severity: string }).severity
    }
    expect(await severityOf('critical')).toBe('critical')
    expect(await severityOf('high')).toBe('error')
    expect(await severityOf('medium')).toBe('warning')
    expect(await severityOf('low')).toBe('info')
    expect(await severityOf('info')).toBe('info')
    expect(await severityOf('something-new')).toBe('warning')
  })

  it('includes a client_url when the rendering carries one', async () => {
    const { ctx, requests } = pagerdutyContext(() => Response.json({ status: 'success', dedup_key: 'inc-1' }))
    await sink.notify(openedEvent, { title: 'T', markdown: 'm', url: 'https://app.smokejumper.dev/incidents/inc-1' }, ctx)
    expect(requests[0]!.body.client_url).toBe('https://app.smokejumper.dev/incidents/inc-1')
  })

  it('resolves the pagerduty event on incident resolution without a payload', async () => {
    const { ctx, requests } = pagerdutyContext(() => Response.json({ status: 'success', dedup_key: 'inc-1' }))
    const receipt = await sink.notify(resolvedEvent, { title: 'Incident resolved', markdown: 'resolved' }, ctx)
    expect(receipt).toEqual({ delivered: true, externalId: 'inc-1' })
    expect(requests[0]!.body).toEqual({ routing_key: 'r0ut1ng-key-2026', event_action: 'resolve', dedup_key: 'inc-1' })
  })

  it('reports pagerduty api errors without throwing', async () => {
    const { ctx } = pagerdutyContext(() => Response.json({ status: 'invalid event', errors: ['routing_key is invalid'] }, { status: 400 }))
    const receipt = await sink.notify(openedEvent, { title: 'T', markdown: 'm' }, ctx)
    expect(receipt.delivered).toBe(false)
    expect(receipt.error).toBe('routing_key is invalid')
  })

  it('reports network failures without throwing', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const ctx: SinkContext<PagerdutyNotifyConfig> = { ...createTestContext(config), fetch: fetchImpl }
    const receipt = await sink.notify(openedEvent, { title: 'T', markdown: 'm' }, ctx)
    expect(receipt).toEqual({ delivered: false, error: 'fetch failed' })
  })
})
