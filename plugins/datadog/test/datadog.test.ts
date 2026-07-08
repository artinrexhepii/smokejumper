import { describe, expect, it } from 'vitest'
import { checkTelemetrySource, type ToolContext } from '@smokejumper/plugin-sdk'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createDatadogTelemetrySource, type DatadogConfig } from '../src/index'

const source = createDatadogTelemetrySource()
const baseConfig: DatadogConfig = { site: 'datadoghq.com', apiKey: 'test-api-key', appKey: 'test-app-key' }
const tool = (name: string) => source.tools().find((t) => t.name === name)!

interface CapturedRequest {
  url: URL
  headers: Record<string, string>
  body?: unknown
}

function fakeDatadogFetch(handlers: Record<string, { status?: number; body: unknown }>, captured: CapturedRequest[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    captured.push({
      url,
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
    })
    const handler = handlers[url.pathname]
    if (!handler) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(handler.body), { status: handler.status ?? 200 })
  }) as typeof fetch
}

function contextWith(fetchImpl: typeof fetch, config: DatadogConfig = baseConfig): ToolContext<DatadogConfig> {
  return { ...createTestContext<DatadogConfig>(config), fetch: fetchImpl, incidentId: 'inc-1' }
}

describe('datadog telemetry source', () => {
  it('passes conformance', async () => {
    const fetchImpl = fakeDatadogFetch({ '/api/v1/validate': { body: { valid: true } } })
    const result = await checkTelemetrySource(source, { ...createTestContext<DatadogConfig>(baseConfig), fetch: fetchImpl })
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('lists metric names filtered by a substring', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeDatadogFetch(
      {
        '/api/v1/metrics': {
          body: { metrics: ['system.cpu.user', 'system.cpu.idle', 'trace.http.request.duration'] },
        },
      },
      captured,
    )
    const t = tool('list_metrics')
    const result = await t.execute(t.inputSchema.parse({ contains: 'cpu' }), contextWith(fetchImpl))
    expect(result.data).toEqual(['system.cpu.user', 'system.cpu.idle'])
    expect(result.summary).toBe('2 metrics')
    expect(captured[0]!.url.pathname).toBe('/api/v1/metrics')
    expect(captured[0]!.url.searchParams.get('from')).toBeTruthy()
  })

  it('lists all metrics unfiltered and caps at the limit', async () => {
    const fetchImpl = fakeDatadogFetch({ '/api/v1/metrics': { body: { metrics: ['a', 'b', 'c'] } } })
    const t = tool('list_metrics')
    const result = await t.execute(t.inputSchema.parse({ limit: 2 }), contextWith(fetchImpl))
    expect(result.data).toEqual(['a', 'b'])
  })

  it('runs a metrics query with the default window', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeDatadogFetch(
      {
        '/api/v1/query': {
          body: {
            status: 'ok',
            series: [{ metric: 'system.cpu.user', scope: 'host:shop-api-1', pointlist: [[1751700000000, 42.3]] }],
          },
        },
      },
      captured,
    )
    const t = tool('query_metrics')
    const result = await t.execute(t.inputSchema.parse({ query: 'avg:system.cpu.user{*}' }), contextWith(fetchImpl))
    expect(result.summary).toBe('avg:system.cpu.user{*}: 1 series over 60m')
    expect(captured[0]!.url.pathname).toBe('/api/v1/query')
    expect(captured[0]!.url.searchParams.get('query')).toBe('avg:system.cpu.user{*}')
    const from = Number(captured[0]!.url.searchParams.get('from'))
    const to = Number(captured[0]!.url.searchParams.get('to'))
    expect(to - from).toBe(60 * 60)
  })

  it('applies a custom minutesAgo to the metrics query', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeDatadogFetch({ '/api/v1/query': { body: { status: 'ok', series: [] } } }, captured)
    const t = tool('query_metrics')
    await t.execute(t.inputSchema.parse({ query: 'avg:system.cpu.user{*}', minutesAgo: 15 }), contextWith(fetchImpl))
    const from = Number(captured[0]!.url.searchParams.get('from'))
    const to = Number(captured[0]!.url.searchParams.get('to'))
    expect(to - from).toBe(15 * 60)
  })

  it('throws when datadog reports a query error', async () => {
    const fetchImpl = fakeDatadogFetch({
      '/api/v1/query': { body: { status: 'error', error: 'unknown metric name', series: [] } },
    })
    const t = tool('query_metrics')
    await expect(t.execute(t.inputSchema.parse({ query: 'bogus{*}' }), contextWith(fetchImpl))).rejects.toThrow(/unknown metric name/)
  })

  it('sends the api key and app key headers on every request', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeDatadogFetch({ '/api/v1/query': { body: { status: 'ok', series: [] } } }, captured)
    const t = tool('query_metrics')
    await t.execute(t.inputSchema.parse({ query: 'up' }), contextWith(fetchImpl))
    expect(captured[0]!.headers['DD-API-KEY']).toBe('test-api-key')
    expect(captured[0]!.headers['DD-APPLICATION-KEY']).toBe('test-app-key')
  })

  it('reports healthy when the api key validates', async () => {
    const fetchImpl = fakeDatadogFetch({ '/api/v1/validate': { body: { valid: true } } })
    const health = await source.healthCheck({ ...createTestContext<DatadogConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(true)
  })

  it('reports unhealthy when the api key is invalid', async () => {
    const fetchImpl = fakeDatadogFetch({ '/api/v1/validate': { body: { valid: false } } })
    const health = await source.healthCheck({ ...createTestContext<DatadogConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(false)
  })

  it('reports unhealthy when the validate endpoint returns a non-2xx status', async () => {
    const fetchImpl = fakeDatadogFetch({ '/api/v1/validate': { status: 403, body: { errors: ['Forbidden'] } } })
    const health = await source.healthCheck({ ...createTestContext<DatadogConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(false)
  })

  it('searches logs with the default window and limit', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeDatadogFetch(
      {
        '/api/v2/logs/events/search': {
          body: {
            data: [
              {
                id: 'AwAAAX-1',
                attributes: {
                  timestamp: '2026-07-06T09:00:00.000Z',
                  message: 'request failed with 500',
                  service: 'shop-api',
                  status: 'error',
                  tags: ['env:prod', 'service:shop-api'],
                },
              },
            ],
          },
        },
      },
      captured,
    )
    const t = tool('search_logs')
    const result = await t.execute(t.inputSchema.parse({ query: 'service:shop-api status:error' }), contextWith(fetchImpl))
    expect(result.summary).toBe('1 log events for "service:shop-api status:error" over 60m')
    const events = result.data as Array<{ message: string; service: string; status: string }>
    expect(events[0]!.message).toBe('request failed with 500')
    expect(events[0]!.service).toBe('shop-api')
    expect(captured[0]!.url.pathname).toBe('/api/v2/logs/events/search')
    expect(captured[0]!.body).toEqual({
      filter: { query: 'service:shop-api status:error', from: 'now-60m', to: 'now' },
      sort: '-timestamp',
      page: { limit: 100 },
    })
  })

  it('applies a custom minutesAgo and limit to the log search', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeDatadogFetch({ '/api/v2/logs/events/search': { body: { data: [] } } }, captured)
    const t = tool('search_logs')
    await t.execute(t.inputSchema.parse({ query: 'service:worker', minutesAgo: 15, limit: 25 }), contextWith(fetchImpl))
    expect(captured[0]!.body).toEqual({
      filter: { query: 'service:worker', from: 'now-15m', to: 'now' },
      sort: '-timestamp',
      page: { limit: 25 },
    })
  })

  it('defaults missing service, status, and tags on log events', async () => {
    const fetchImpl = fakeDatadogFetch({
      '/api/v2/logs/events/search': {
        body: { data: [{ id: 'AwAAAX-2', attributes: { timestamp: '2026-07-06T09:05:00.000Z', message: 'no metadata' } }] },
      },
    })
    const t = tool('search_logs')
    const result = await t.execute(t.inputSchema.parse({ query: '*' }), contextWith(fetchImpl))
    const events = result.data as Array<{ service: string; status: string; tags: string[] }>
    expect(events[0]).toMatchObject({ service: 'unknown', status: 'info', tags: [] })
  })

  it('lists monitors with no filters', async () => {
    const fetchImpl = fakeDatadogFetch({
      '/api/v1/monitor': {
        body: [{ id: 1, name: 'shop-api error rate', query: 'avg(last_5m):...', overall_state: 'OK', tags: ['service:shop-api'] }],
      },
    })
    const t = tool('list_monitors')
    const result = await t.execute(t.inputSchema.parse({}), contextWith(fetchImpl))
    expect(result.summary).toBe('1 monitors')
    const monitors = result.data as Array<{ overallState: string }>
    expect(monitors[0]!.overallState).toBe('OK')
  })

  it('filters monitors by group state and tags', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeDatadogFetch({ '/api/v1/monitor': { body: [] } }, captured)
    const t = tool('list_monitors')
    await t.execute(t.inputSchema.parse({ groupStates: 'alert', tags: 'service:shop-api' }), contextWith(fetchImpl))
    expect(captured[0]!.url.searchParams.get('group_states')).toBe('alert')
    expect(captured[0]!.url.searchParams.get('monitor_tags')).toBe('service:shop-api')
  })
})
