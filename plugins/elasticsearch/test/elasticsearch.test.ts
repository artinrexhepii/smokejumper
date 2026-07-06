import { describe, expect, it } from 'vitest'
import { checkTelemetrySource, type ToolContext } from '@smokejumper/plugin-sdk'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createElasticsearchTelemetrySource, flattenEsHits, type ElasticsearchConfig } from '../src/index'

const source = createElasticsearchTelemetrySource()
const baseConfig: ElasticsearchConfig = { url: 'http://elasticsearch.test', indexPattern: 'logs-*', apiKey: 'test-api-key' }
const tool = (name: string) => source.tools().find((t) => t.name === name)!

interface CapturedRequest {
  url: URL
  method: string
  headers: Record<string, string>
  body?: string
}

function fakeEsFetch(handlers: Record<string, unknown>, captured: CapturedRequest[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body as string | undefined,
    })
    if (url.pathname === '/_cluster/health') return Response.json({ cluster_name: 'test', status: 'green' })
    const body = handlers[url.pathname]
    if (body === undefined) return new Response('not found', { status: 404 })
    return Response.json(body)
  }) as typeof fetch
}

function contextWith(fetchImpl: typeof fetch, config: ElasticsearchConfig = baseConfig): ToolContext<ElasticsearchConfig> {
  return { ...createTestContext<ElasticsearchConfig>(config), fetch: fetchImpl, incidentId: 'inc-1' }
}

describe('flattenEsHits', () => {
  it('flattens hits into log entries', () => {
    const hits = [
      { _index: 'logs-2026.07.06', _id: '1', _source: { '@timestamp': '2026-07-06T09:00:00.000Z', message: 'boom' } },
      { _index: 'logs-2026.07.06', _id: '2', _source: { message: 'no timestamp' } },
    ]
    const entries = flattenEsHits(hits)
    expect(entries[0]).toEqual({
      timestamp: '2026-07-06T09:00:00.000Z',
      index: 'logs-2026.07.06',
      id: '1',
      source: { '@timestamp': '2026-07-06T09:00:00.000Z', message: 'boom' },
    })
    expect(entries[1]!.timestamp).toBe(new Date(0).toISOString())
  })

  it('returns an empty array for no hits', () => {
    expect(flattenEsHits([])).toEqual([])
  })
})

describe('elasticsearch telemetry source', () => {
  it('passes conformance', async () => {
    const result = await checkTelemetrySource(source, { ...createTestContext<ElasticsearchConfig>(baseConfig), fetch: fakeEsFetch({}) })
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('searches logs with a time-bounded query_string over the index pattern', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeEsFetch(
      {
        '/logs-*/_search': {
          hits: {
            total: { value: 1, relation: 'eq' },
            hits: [{ _index: 'logs-2026.07.06', _id: '1', _source: { '@timestamp': '2026-07-06T09:00:00.000Z', message: 'boom' } }],
          },
        },
      },
      captured,
    )
    const t = tool('search_logs')
    const result = await t.execute(t.inputSchema.parse({ query: 'level:error' }), contextWith(fetchImpl))
    expect(result.summary).toBe('level:error: 1 log lines over 60m')
    expect(captured[0]!.method).toBe('POST')
    expect(captured[0]!.url.pathname).toBe('/logs-*/_search')
    const body = JSON.parse(captured[0]!.body!) as {
      query: { bool: { must: Array<{ query_string: { query: string } }> } }
      size: number
    }
    expect(body.query.bool.must[0]!.query_string.query).toBe('level:error')
    expect(body.size).toBe(100)
  })

  it('lists indices matching the configured pattern', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeEsFetch(
      {
        '/_cat/indices/logs-*': [
          { health: 'green', status: 'open', index: 'logs-2026.07.06', 'docs.count': '1000', 'store.size': '5mb' },
        ],
      },
      captured,
    )
    const t = tool('list_indices')
    const result = await t.execute(t.inputSchema.parse({}), contextWith(fetchImpl))
    expect(result.summary).toBe('1 indices matching "logs-*"')
    expect(captured[0]!.url.pathname).toBe('/_cat/indices/logs-*')
    expect(captured[0]!.url.searchParams.get('format')).toBe('json')
  })

  it('applies an api key header when configured', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeEsFetch({ '/logs-*/_search': { hits: { total: { value: 0, relation: 'eq' }, hits: [] } } }, captured)
    const t = tool('search_logs')
    await t.execute(t.inputSchema.parse({ query: '*' }), contextWith(fetchImpl, { ...baseConfig, apiKey: 'my-api-key' }))
    expect(captured[0]!.headers.authorization).toBe('ApiKey my-api-key')
  })

  it('applies a basic auth header when username and password are set and no api key is present', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeEsFetch({ '/logs-*/_search': { hits: { total: { value: 0, relation: 'eq' }, hits: [] } } }, captured)
    const t = tool('search_logs')
    const config: ElasticsearchConfig = { url: baseConfig.url, indexPattern: baseConfig.indexPattern, username: 'elastic', password: 'changeme' }
    await t.execute(t.inputSchema.parse({ query: '*' }), contextWith(fetchImpl, config))
    expect(captured[0]!.headers.authorization).toBe(`Basic ${Buffer.from('elastic:changeme').toString('base64')}`)
  })

  it('reports healthy when the cluster status is green', async () => {
    const fetchImpl = fakeEsFetch({})
    const health = await source.healthCheck({ ...createTestContext<ElasticsearchConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(true)
  })

  it('reports healthy when the cluster status is yellow', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const { pathname } = new URL(String(input))
      if (pathname === '/_cluster/health') return Response.json({ cluster_name: 'test', status: 'yellow' })
      return new Response('not found', { status: 404 })
    }) as typeof fetch
    const health = await source.healthCheck({ ...createTestContext<ElasticsearchConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(true)
  })

  it('reports unhealthy when the cluster status is red', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const { pathname } = new URL(String(input))
      if (pathname === '/_cluster/health') return Response.json({ cluster_name: 'test', status: 'red' })
      return new Response('not found', { status: 404 })
    }) as typeof fetch
    const health = await source.healthCheck({ ...createTestContext<ElasticsearchConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(false)
  })

  it('reports unhealthy when the health request fails', async () => {
    const fetchImpl = (async () => new Response('down', { status: 503 })) as typeof fetch
    const health = await source.healthCheck({ ...createTestContext<ElasticsearchConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(false)
  })
})
