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
