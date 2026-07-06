import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createDatadogTelemetrySource, type DatadogConfig } from '../src/index'

const enabled = process.env.SMOKEJUMPER_INTEGRATION === '1'
const config: DatadogConfig = { site: 'datadoghq.com', apiKey: 'test-api-key', appKey: 'test-app-key' }
const source = createDatadogTelemetrySource()

function fakeDatadogServer(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/api/v1/validate') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ valid: true }))
      return
    }
    if (url.pathname === '/api/v1/query') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          series: [{ metric: 'system.cpu.user', scope: 'host:shop-api-1', pointlist: [[Date.now(), 42.3]] }],
        }),
      )
      return
    }
    if (url.pathname === '/api/v2/logs/events/search') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          data: [
            {
              id: 'AwAAAX-integration',
              attributes: {
                timestamp: new Date().toISOString(),
                message: 'integration probe log',
                service: 'shop-api',
                status: 'error',
                tags: ['env:prod'],
              },
            },
          ],
        }),
      )
      return
    }
    if (url.pathname === '/api/v1/monitor') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify([
          {
            id: 1,
            name: 'shop-api error rate',
            query: 'avg(last_5m):sum:trace.http.errors{*} > 50',
            overall_state: 'Alert',
            tags: ['service:shop-api'],
          },
        ]),
      )
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
}

function proxyFetchTo(port: number): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const original = new URL(String(input))
    const proxied = new URL(`${original.pathname}${original.search}`, `http://127.0.0.1:${port}`)
    return fetch(proxied, init)
  }) as typeof fetch
}

describe.skipIf(!enabled)('datadog integration', () => {
  let server: Server
  let port: number

  beforeAll(async () => {
    server = fakeDatadogServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not bind to a port')
    port = address.port
  })

  afterAll(() => {
    server.close()
  })

  it('reports healthy against the fake datadog server', async () => {
    const ctx = { ...createTestContext<DatadogConfig>(config), fetch: proxyFetchTo(port) }
    const health = await source.healthCheck(ctx)
    expect(health.ok).toBe(true)
  })

  it('queries metrics over a real network connection', async () => {
    const ctx = { ...createTestContext<DatadogConfig>(config), fetch: proxyFetchTo(port), incidentId: 'inc-1' }
    const tool = source.tools().find((t) => t.name === 'query_metrics')!
    const result = await tool.execute(tool.inputSchema.parse({ query: 'avg:system.cpu.user{*}' }), ctx)
    const series = result.data as Array<{ metric: string }>
    expect(series[0]?.metric).toBe('system.cpu.user')
  })

  it('searches logs over a real network connection', async () => {
    const ctx = { ...createTestContext<DatadogConfig>(config), fetch: proxyFetchTo(port), incidentId: 'inc-1' }
    const tool = source.tools().find((t) => t.name === 'search_logs')!
    const result = await tool.execute(tool.inputSchema.parse({ query: 'service:shop-api status:error' }), ctx)
    const events = result.data as Array<{ message: string }>
    expect(events.some((e) => e.message === 'integration probe log')).toBe(true)
  })

  it('lists monitors over a real network connection', async () => {
    const ctx = { ...createTestContext<DatadogConfig>(config), fetch: proxyFetchTo(port), incidentId: 'inc-1' }
    const tool = source.tools().find((t) => t.name === 'list_monitors')!
    const result = await tool.execute(tool.inputSchema.parse({}), ctx)
    const monitors = result.data as Array<{ name: string }>
    expect(monitors.some((m) => m.name === 'shop-api error rate')).toBe(true)
  })
})
