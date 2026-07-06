import { describe, expect, it } from 'vitest'
import { checkTelemetrySource, type ToolContext } from '@smokejumper/plugin-sdk'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createPrometheusTelemetrySource, type PrometheusConfig } from '../src/index'

const source = createPrometheusTelemetrySource()
const baseConfig: PrometheusConfig = { url: 'http://prometheus.test' }

const tool = (name: string) => source.tools().find((t) => t.name === name)!

interface CapturedRequest {
  url: URL
  headers: Record<string, string>
}

function fakePrometheusFetch(handlers: Record<string, unknown>, captured: CapturedRequest[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    captured.push({ url, headers: (init?.headers as Record<string, string>) ?? {} })
    const body = handlers[url.pathname]
    if (body === undefined) return new Response('not found', { status: 404 })
    return Response.json(body)
  }) as typeof fetch
}

function contextWith(fetchImpl: typeof fetch, config: PrometheusConfig = baseConfig): ToolContext<PrometheusConfig> {
  return { ...createTestContext<PrometheusConfig>(config), fetch: fetchImpl, incidentId: 'inc-1' }
}

describe('prometheus telemetry source', () => {
  it('passes conformance', async () => {
    const fetchImpl = fakePrometheusFetch({ '/-/healthy': 'ok' })
    const result = await checkTelemetrySource(source, { ...createTestContext<PrometheusConfig>(baseConfig), fetch: fetchImpl })
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('runs an instant query', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakePrometheusFetch(
      {
        '/api/v1/query': {
          status: 'success',
          data: { resultType: 'vector', result: [{ metric: { __name__: 'up' }, value: [1751000000, '1'] }] },
        },
      },
      captured,
    )
    const result = await tool('instant_query').execute(tool('instant_query').inputSchema.parse({ query: 'up' }), contextWith(fetchImpl))
    expect(result.summary).toBe('up: 1 results')
    expect(captured[0]!.url.pathname).toBe('/api/v1/query')
    expect(captured[0]!.url.searchParams.get('query')).toBe('up')
  })

  it('runs a range query with the default window and step', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakePrometheusFetch(
      { '/api/v1/query_range': { status: 'success', data: { resultType: 'matrix', result: [] } } },
      captured,
    )
    const t = tool('range_query')
    const result = await t.execute(t.inputSchema.parse({ query: 'rate(http_requests_total[5m])' }), contextWith(fetchImpl))
    expect(result.summary).toContain('over 60m')
    expect(captured[0]!.url.searchParams.get('step')).toBe('60')
    const start = Number(captured[0]!.url.searchParams.get('start'))
    const end = Number(captured[0]!.url.searchParams.get('end'))
    expect(end - start).toBe(60 * 60)
  })

  it('applies a custom minutesAgo and stepSeconds to the range query', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakePrometheusFetch(
      { '/api/v1/query_range': { status: 'success', data: { resultType: 'matrix', result: [] } } },
      captured,
    )
    const t = tool('range_query')
    await t.execute(t.inputSchema.parse({ query: 'up', minutesAgo: 30, stepSeconds: 15 }), contextWith(fetchImpl))
    expect(captured[0]!.url.searchParams.get('step')).toBe('15')
    const start = Number(captured[0]!.url.searchParams.get('start'))
    const end = Number(captured[0]!.url.searchParams.get('end'))
    expect(end - start).toBe(30 * 60)
  })

  it('lists active alerts', async () => {
    const fetchImpl = fakePrometheusFetch({
      '/api/v1/alerts': {
        status: 'success',
        data: { alerts: [{ labels: { alertname: 'HighLoad' }, state: 'firing', activeAt: '2026-07-05T09:00:00Z' }] },
      },
    })
    const t = tool('list_alerts')
    const result = await t.execute(t.inputSchema.parse({}), contextWith(fetchImpl))
    expect(result.summary).toBe('1 active alerts')
    expect((result.data as Array<{ state: string }>)[0]!.state).toBe('firing')
  })

  it('lists targets filtered by state', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakePrometheusFetch(
      {
        '/api/v1/targets': {
          status: 'success',
          data: { activeTargets: [{ scrapeUrl: 'http://shop-api:3401/metrics', health: 'up' }], droppedTargets: [] },
        },
      },
      captured,
    )
    const t = tool('list_targets')
    const result = await t.execute(t.inputSchema.parse({ state: 'active' }), contextWith(fetchImpl))
    expect(result.summary).toBe('1 active, 0 dropped targets')
    expect(captured[0]!.url.searchParams.get('state')).toBe('active')
  })

  it('applies a bearer token header to every request', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakePrometheusFetch(
      { '/api/v1/query': { status: 'success', data: { resultType: 'vector', result: [] } } },
      captured,
    )
    const t = tool('instant_query')
    await t.execute(t.inputSchema.parse({ query: 'up' }), contextWith(fetchImpl, { ...baseConfig, bearerToken: 'tok-123' }))
    expect(captured[0]!.headers.authorization).toBe('Bearer tok-123')
  })

  it('applies a basic auth header when user and password are set', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakePrometheusFetch(
      { '/api/v1/query': { status: 'success', data: { resultType: 'vector', result: [] } } },
      captured,
    )
    const t = tool('instant_query')
    await t.execute(
      t.inputSchema.parse({ query: 'up' }),
      contextWith(fetchImpl, { ...baseConfig, basicAuthUser: 'admin', basicAuthPassword: 'secret' }),
    )
    expect(captured[0]!.headers.authorization).toBe(`Basic ${Buffer.from('admin:secret').toString('base64')}`)
  })

  it('throws when prometheus returns a query error', async () => {
    const fetchImpl = fakePrometheusFetch({
      '/api/v1/query': { status: 'error', data: { resultType: 'vector', result: [] }, error: 'parse error' },
    })
    const t = tool('instant_query')
    await expect(t.execute(t.inputSchema.parse({ query: '???' }), contextWith(fetchImpl))).rejects.toThrow(/parse error/)
  })

  it('falls back to buildinfo when /-/healthy fails', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const { pathname } = new URL(String(input))
      if (pathname === '/-/healthy') return new Response('unhealthy', { status: 503 })
      if (pathname === '/api/v1/status/buildinfo') return Response.json({ status: 'success', data: {} })
      return new Response('not found', { status: 404 })
    }) as typeof fetch
    const health = await source.healthCheck({ ...createTestContext<PrometheusConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(true)
  })

  it('reports unhealthy when both health endpoints fail', async () => {
    const fetchImpl = (async () => new Response('down', { status: 503 })) as typeof fetch
    const health = await source.healthCheck({ ...createTestContext<PrometheusConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(false)
  })
})
