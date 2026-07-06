import { describe, expect, it } from 'vitest'
import { checkTelemetrySource, type ToolContext } from '@smokejumper/plugin-sdk'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createGrafanaTelemetrySource, type GrafanaConfig } from '../src/index'

const source = createGrafanaTelemetrySource()
const baseConfig: GrafanaConfig = { url: 'http://grafana.test', apiToken: 'glsa_test_token' }
const tool = (name: string) => source.tools().find((t) => t.name === name)!

interface CapturedRequest {
  url: URL
  headers: Record<string, string>
}

function fakeGrafanaFetch(handlers: Record<string, unknown>, captured: CapturedRequest[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    captured.push({ url, headers: (init?.headers as Record<string, string>) ?? {} })
    if (url.pathname === '/api/health') return Response.json({ commit: 'abc123', database: 'ok', version: '11.2.0' })
    const body = handlers[url.pathname]
    if (body === undefined) return new Response('not found', { status: 404 })
    return Response.json(body)
  }) as typeof fetch
}

function contextWith(fetchImpl: typeof fetch, config: GrafanaConfig = baseConfig): ToolContext<GrafanaConfig> {
  return { ...createTestContext<GrafanaConfig>(config), fetch: fetchImpl, incidentId: 'inc-1' }
}

describe('grafana telemetry source', () => {
  it('passes conformance', async () => {
    const result = await checkTelemetrySource(source, { ...createTestContext<GrafanaConfig>(baseConfig), fetch: fakeGrafanaFetch({}) })
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('lists datasources and sends the bearer token', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeGrafanaFetch(
      {
        '/api/datasources': [
          { id: 1, uid: 'prom-uid', name: 'Prometheus', type: 'prometheus', url: 'http://prometheus:9090', isDefault: true },
        ],
      },
      captured,
    )
    const t = tool('list_datasources')
    const result = await t.execute(t.inputSchema.parse({}), contextWith(fetchImpl))
    expect(result.summary).toBe('1 datasources')
    expect(captured[0]!.url.pathname).toBe('/api/datasources')
    expect(captured[0]!.headers.authorization).toBe('Bearer glsa_test_token')
  })

  it('queries a datasource through the proxy over the default window', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeGrafanaFetch(
      {
        '/api/datasources/proxy/1/api/v1/query_range': {
          status: 'success',
          data: { resultType: 'matrix', result: [{ metric: {}, values: [] }] },
        },
      },
      captured,
    )
    const t = tool('query_datasource')
    const result = await t.execute(
      t.inputSchema.parse({ datasourceId: 1, query: 'rate(http_requests_total[5m])' }),
      contextWith(fetchImpl),
    )
    expect(result.summary).toBe('rate(http_requests_total[5m]): 1 series over 60m via datasource 1')
    expect(captured[0]!.url.pathname).toBe('/api/datasources/proxy/1/api/v1/query_range')
    expect(captured[0]!.url.searchParams.get('step')).toBe('60')
    const start = Number(captured[0]!.url.searchParams.get('start'))
    const end = Number(captured[0]!.url.searchParams.get('end'))
    expect(end - start).toBe(60 * 60)
  })

  it('throws when the proxied datasource returns an error status', async () => {
    const fetchImpl = fakeGrafanaFetch({
      '/api/datasources/proxy/1/api/v1/query_range': {
        status: 'error',
        data: { resultType: 'matrix', result: [] },
        error: 'bad query',
      },
    })
    const t = tool('query_datasource')
    await expect(
      t.execute(t.inputSchema.parse({ datasourceId: 1, query: '???' }), contextWith(fetchImpl)),
    ).rejects.toThrow(/bad query/)
  })

  it('searches annotations within the default window', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeGrafanaFetch(
      { '/api/annotations': [{ id: 1, time: 1751700000000, text: 'deploy v42', tags: ['deploy'] }] },
      captured,
    )
    const t = tool('search_annotations')
    const result = await t.execute(t.inputSchema.parse({}), contextWith(fetchImpl))
    expect(result.summary).toBe('1 annotations over 60m')
    expect(captured[0]!.url.searchParams.has('from')).toBe(true)
    expect(captured[0]!.url.searchParams.has('to')).toBe(true)
  })

  it('appends repeated tags query params to the annotations search', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeGrafanaFetch({ '/api/annotations': [] }, captured)
    const t = tool('search_annotations')
    await t.execute(t.inputSchema.parse({ tags: ['deploy', 'incident'] }), contextWith(fetchImpl))
    expect(captured[0]!.url.searchParams.getAll('tags')).toEqual(['deploy', 'incident'])
  })

  it('reports healthy when the grafana database is ok', async () => {
    const fetchImpl = fakeGrafanaFetch({})
    const health = await source.healthCheck({ ...createTestContext<GrafanaConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(true)
  })

  it('reports unhealthy when the grafana database is not ok', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const { pathname } = new URL(String(input))
      if (pathname === '/api/health') return Response.json({ commit: 'abc123', database: 'failing', version: '11.2.0' })
      return new Response('not found', { status: 404 })
    }) as typeof fetch
    const health = await source.healthCheck({ ...createTestContext<GrafanaConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(false)
  })

  it('reports unhealthy when the health endpoint request fails', async () => {
    const fetchImpl = (async () => new Response('down', { status: 503 })) as typeof fetch
    const health = await source.healthCheck({ ...createTestContext<GrafanaConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(false)
  })
})
