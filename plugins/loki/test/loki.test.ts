import { describe, expect, it } from 'vitest'
import { checkTelemetrySource, type ToolContext } from '@smokejumper/plugin-sdk'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createLokiTelemetrySource, flattenLokiStreams, type LokiConfig } from '../src/index'

const source = createLokiTelemetrySource()
const baseConfig: LokiConfig = { url: 'http://loki.test' }
const tool = (name: string) => source.tools().find((t) => t.name === name)!

interface CapturedRequest {
  url: URL
  headers: Record<string, string>
}

function fakeLokiFetch(handlers: Record<string, unknown>, captured: CapturedRequest[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    captured.push({ url, headers: (init?.headers as Record<string, string>) ?? {} })
    if (url.pathname === '/ready') return new Response('ready')
    const body = handlers[url.pathname]
    if (body === undefined) return new Response('not found', { status: 404 })
    return Response.json(body)
  }) as typeof fetch
}

function contextWith(fetchImpl: typeof fetch, config: LokiConfig = baseConfig): ToolContext<LokiConfig> {
  return { ...createTestContext<LokiConfig>(config), fetch: fetchImpl, incidentId: 'inc-1' }
}

describe('flattenLokiStreams', () => {
  it('flattens streams into timestamped lines sorted ascending', () => {
    const streams = [
      {
        stream: { app: 'shop-api' },
        values: [
          ['1751709600000000000', 'started'],
          ['1751709660000000000', 'ready'],
        ] as [string, string][],
      },
      { stream: { app: 'worker' }, values: [['1751709630000000000', 'processing job 42']] as [string, string][] },
    ]
    const lines = flattenLokiStreams(streams)
    expect(lines.map((l) => l.line)).toEqual(['started', 'processing job 42', 'ready'])
    expect(lines[0]!.labels).toEqual({ app: 'shop-api' })
    expect(Number.isNaN(Date.parse(lines[0]!.timestamp))).toBe(false)
  })

  it('returns an empty array for no streams', () => {
    expect(flattenLokiStreams([])).toEqual([])
  })
})

describe('loki telemetry source', () => {
  it('passes conformance', async () => {
    const result = await checkTelemetrySource(source, createTestContext<LokiConfig>(baseConfig))
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('runs a range query and flattens streams to lines', async () => {
    const fetchImpl = fakeLokiFetch({
      '/loki/api/v1/query_range': {
        status: 'success',
        data: { resultType: 'streams', result: [{ stream: { app: 'shop-api' }, values: [['1751709600000000000', 'boom']] }] },
      },
    })
    const t = tool('query_range')
    const result = await t.execute(t.inputSchema.parse({ query: '{app="shop-api"}' }), contextWith(fetchImpl))
    expect(result.summary).toContain('1 log lines')
    expect((result.data as Array<{ line: string }>)[0]!.line).toBe('boom')
  })

  it('applies minutesAgo and limit to the range query', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeLokiFetch(
      { '/loki/api/v1/query_range': { status: 'success', data: { resultType: 'streams', result: [] } } },
      captured,
    )
    const t = tool('query_range')
    await t.execute(t.inputSchema.parse({ query: '{app="worker"}', minutesAgo: 15, limit: 50 }), contextWith(fetchImpl))
    expect(captured[0]!.url.searchParams.get('limit')).toBe('50')
    const start = BigInt(captured[0]!.url.searchParams.get('start')!)
    const end = BigInt(captured[0]!.url.searchParams.get('end')!)
    expect(Number((end - start) / 1_000_000_000n)).toBe(15 * 60)
  })

  it('lists labels', async () => {
    const fetchImpl = fakeLokiFetch({ '/loki/api/v1/labels': { status: 'success', data: ['app', 'env'] } })
    const t = tool('labels')
    const result = await t.execute(t.inputSchema.parse({}), contextWith(fetchImpl))
    expect(result.data).toEqual(['app', 'env'])
  })

  it('lists label values', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeLokiFetch({ '/loki/api/v1/label/app/values': { status: 'success', data: ['shop-api', 'worker'] } }, captured)
    const t = tool('label_values')
    const result = await t.execute(t.inputSchema.parse({ label: 'app' }), contextWith(fetchImpl))
    expect(result.data).toEqual(['shop-api', 'worker'])
    expect(captured[0]!.url.pathname).toBe('/loki/api/v1/label/app/values')
  })

  it('sends the tenant id as X-Scope-OrgID', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeLokiFetch({ '/loki/api/v1/labels': { status: 'success', data: [] } }, captured)
    const t = tool('labels')
    await t.execute(t.inputSchema.parse({}), contextWith(fetchImpl, { ...baseConfig, tenantId: 'tenant-a' }))
    expect(captured[0]!.headers['X-Scope-OrgID']).toBe('tenant-a')
  })

  it('applies a bearer token header', async () => {
    const captured: CapturedRequest[] = []
    const fetchImpl = fakeLokiFetch({ '/loki/api/v1/labels': { status: 'success', data: [] } }, captured)
    const t = tool('labels')
    await t.execute(t.inputSchema.parse({}), contextWith(fetchImpl, { ...baseConfig, bearerToken: 'tok-xyz' }))
    expect(captured[0]!.headers.authorization).toBe('Bearer tok-xyz')
  })

  it('reports healthy when /ready responds ok', async () => {
    const fetchImpl = fakeLokiFetch({})
    const health = await source.healthCheck({ ...createTestContext<LokiConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(true)
  })

  it('reports unhealthy when /ready fails', async () => {
    const fetchImpl = (async () => new Response('not ready', { status: 503 })) as typeof fetch
    const health = await source.healthCheck({ ...createTestContext<LokiConfig>(baseConfig), fetch: fetchImpl })
    expect(health.ok).toBe(false)
  })
})
