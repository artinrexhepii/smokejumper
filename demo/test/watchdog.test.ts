import { describe, expect, it } from 'vitest'
import { createWatchdogState, pollOnce, type WatchdogConfig } from '../src/watchdog'

interface Sent {
  url: string
  init?: RequestInit
}

function fakeFetch(routes: Record<string, () => Response | Error>, sent: Sent[]): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    sent.push({ url, init })
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        const out = handler()
        if (out instanceof Error) throw out
        return out
      }
    }
    throw new Error(`no fake route for ${url}`)
  }) as typeof fetch
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const healthy = () => json({ ok: true, failing: [] }, 200)
const degraded = () => json({ ok: false, failing: ['error rate 86% on /products (last 7 requests)'] }, 503)
const accepted = () => json({ accepted: 1 }, 200)

function makeConfig(routes: Record<string, () => Response | Error>, sent: Sent[], logs: string[]): WatchdogConfig {
  return {
    targets: [
      { name: 'shop-api', url: 'http://shop', syntheticPath: '/products' },
      { name: 'worker', url: 'http://work' },
    ],
    ingestUrl: 'http://server/ingest/00000000-0000-4000-8000-000000000001',
    token: 'demo-token',
    fetchImpl: fakeFetch(routes, sent),
    log: (m) => logs.push(m),
  }
}

describe('pollOnce', () => {
  it('sends nothing while everything is healthy, but drives synthetic traffic first', async () => {
    const sent: Sent[] = []
    const config = makeConfig(
      { 'http://shop/products': healthy, 'http://shop/healthz': healthy, 'http://work/healthz': healthy },
      sent,
      [],
    )
    const result = await pollOnce(config, createWatchdogState())
    expect(result.alertsSent).toBe(0)
    const urls = sent.map((s) => s.url)
    expect(urls.indexOf('http://shop/products')).toBeGreaterThanOrEqual(0)
    expect(urls.indexOf('http://shop/products')).toBeLessThan(urls.indexOf('http://shop/healthz'))
    expect(urls.some((u) => u.startsWith('http://server/ingest'))).toBe(false)
  })

  it('posts a webhook alert with the demo token when a target degrades', async () => {
    const sent: Sent[] = []
    const config = makeConfig(
      {
        'http://shop/products': degraded,
        'http://shop/healthz': degraded,
        'http://work/healthz': healthy,
        'http://server/ingest': accepted,
      },
      sent,
      [],
    )
    const result = await pollOnce(config, createWatchdogState())
    expect(result.alertsSent).toBe(1)
    const ingest = sent.find((s) => s.url.startsWith('http://server/ingest'))!
    expect(ingest.url).toBe('http://server/ingest/00000000-0000-4000-8000-000000000001')
    const headers = ingest.init?.headers as Record<string, string>
    expect(headers['x-smokejumper-token']).toBe('demo-token')
    const body = JSON.parse(String(ingest.init?.body)) as Record<string, unknown>
    expect(body.title).toContain('shop-api unhealthy')
    expect(body.title).toContain('error rate')
    expect(body.severity).toBe('high')
    expect(body.service).toBe('shop-api')
    expect(body.dedupKey).toBe('shop-api-health')
    expect(body.labels).toEqual({ env: 'demo' })
  })

  it('escalates to critical when a target is unreachable', async () => {
    const sent: Sent[] = []
    const config = makeConfig(
      {
        'http://shop/products': () => new Error('ECONNREFUSED'),
        'http://shop/healthz': () => new Error('ECONNREFUSED'),
        'http://work/healthz': healthy,
        'http://server/ingest': accepted,
      },
      sent,
      [],
    )
    const result = await pollOnce(config, createWatchdogState())
    expect(result.alertsSent).toBe(1)
    const ingest = sent.find((s) => s.url.startsWith('http://server/ingest'))!
    const body = JSON.parse(String(ingest.init?.body)) as Record<string, unknown>
    expect(body.title).toContain('shop-api unreachable')
    expect(body.severity).toBe('critical')
  })

  it('re-alerts on every poll while a target stays unhealthy', async () => {
    const sent: Sent[] = []
    const state = createWatchdogState()
    const config = makeConfig(
      {
        'http://shop/products': degraded,
        'http://shop/healthz': degraded,
        'http://work/healthz': healthy,
        'http://server/ingest': accepted,
      },
      sent,
      [],
    )
    expect((await pollOnce(config, state)).alertsSent).toBe(1)
    expect((await pollOnce(config, state)).alertsSent).toBe(1)
    expect(sent.filter((s) => s.url.startsWith('http://server/ingest'))).toHaveLength(2)
  })

  it('logs recovery when a down target turns healthy again', async () => {
    const logs: string[] = []
    const state = createWatchdogState()
    const sentDown: Sent[] = []
    await pollOnce(
      makeConfig(
        {
          'http://shop/products': degraded,
          'http://shop/healthz': degraded,
          'http://work/healthz': healthy,
          'http://server/ingest': accepted,
        },
        sentDown,
        logs,
      ),
      state,
    )
    expect(state.down.has('shop-api')).toBe(true)
    const sentUp: Sent[] = []
    const result = await pollOnce(
      makeConfig(
        { 'http://shop/products': healthy, 'http://shop/healthz': healthy, 'http://work/healthz': healthy },
        sentUp,
        logs,
      ),
      state,
    )
    expect(result.alertsSent).toBe(0)
    expect(state.down.has('shop-api')).toBe(false)
    expect(logs.some((m) => m.includes('shop-api recovered'))).toBe(true)
  })

  it('survives an unreachable ingest endpoint', async () => {
    const logs: string[] = []
    const sent: Sent[] = []
    const config = makeConfig(
      {
        'http://shop/products': degraded,
        'http://shop/healthz': degraded,
        'http://work/healthz': healthy,
        'http://server/ingest': () => new Error('ECONNREFUSED'),
      },
      sent,
      logs,
    )
    const result = await pollOnce(config, createWatchdogState())
    expect(result.alertsSent).toBe(0)
    expect(logs.some((m) => m.includes('ingest'))).toBe(true)
  })
})
