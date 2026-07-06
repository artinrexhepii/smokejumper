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
}

function fakeDatadogFetch(handlers: Record<string, { status?: number; body: unknown }>, captured: CapturedRequest[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    captured.push({ url, headers: (init?.headers as Record<string, string>) ?? {} })
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
})
