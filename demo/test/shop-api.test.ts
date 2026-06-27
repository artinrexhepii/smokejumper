import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createShopApi, type ShopApiOptions } from '../src/shop-api'
import { createWorker } from '../src/worker'

let worker: FastifyInstance
let workerUrl: string
const shops: FastifyInstance[] = []

function makeShop(opts: Partial<ShopApiOptions> = {}): FastifyInstance {
  const app = createShopApi({ workerUrl, ...opts })
  shops.push(app)
  return app
}

beforeAll(async () => {
  worker = createWorker()
  await worker.listen({ port: 0, host: '127.0.0.1' })
  const addr = worker.server.address()
  if (!addr || typeof addr === 'string') throw new Error('worker has no address')
  workerUrl = `http://127.0.0.1:${addr.port}`
})

afterEach(async () => {
  while (shops.length > 0) await shops.pop()!.close()
})

afterAll(async () => {
  await worker.close()
})

describe('shop-api happy path', () => {
  it('lists products with prices from the worker', async () => {
    const app = makeShop()
    const res = await app.inject({ method: 'GET', url: '/products' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { products: Array<{ id: string; price: number; currency: string }> }
    expect(body.products).toHaveLength(3)
    for (const p of body.products) {
      expect(p.price).toBeGreaterThan(0)
      expect(p.currency).toBe('USD')
    }
  })

  it('starts healthy', async () => {
    const app = makeShop()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, service: 'shop-api', failing: [] })
  })

  it('rejects unknown chaos scenarios', async () => {
    const app = makeShop()
    const res = await app.inject({ method: 'POST', url: '/chaos/blizzard' })
    expect(res.statusCode).toBe(400)
  })
})

describe('error-storm', () => {
  it('500s /products and degrades health from observed outcomes', async () => {
    const app = makeShop()
    await app.inject({ method: 'POST', url: '/chaos/error-storm' })
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: 'GET', url: '/products' })
      expect(res.statusCode).toBe(500)
    }
    const health = await app.inject({ method: 'GET', url: '/healthz' })
    expect(health.statusCode).toBe(503)
    const body = health.json() as { ok: boolean; failing: string[] }
    expect(body.ok).toBe(false)
    expect(body.failing.join(' ')).toContain('error rate')
  })

  it('needs at least 5 observed requests before declaring unhealthy', async () => {
    const app = makeShop()
    await app.inject({ method: 'POST', url: '/chaos/error-storm' })
    for (let i = 0; i < 3; i++) await app.inject({ method: 'GET', url: '/products' })
    const health = await app.inject({ method: 'GET', url: '/healthz' })
    expect(health.statusCode).toBe(200)
  })

  it('recovers after reset', async () => {
    const app = makeShop()
    await app.inject({ method: 'POST', url: '/chaos/error-storm' })
    for (let i = 0; i < 6; i++) await app.inject({ method: 'GET', url: '/products' })
    await app.inject({ method: 'POST', url: '/chaos/reset' })
    const health = await app.inject({ method: 'GET', url: '/healthz' })
    expect(health.statusCode).toBe(200)
    const products = await app.inject({ method: 'GET', url: '/products' })
    expect(products.statusCode).toBe(200)
  })
})

describe('dependency-outage', () => {
  it('502s when worker calls time out', async () => {
    const app = makeShop()
    await app.inject({ method: 'POST', url: '/chaos/dependency-outage' })
    const res = await app.inject({ method: 'GET', url: '/products' })
    expect(res.statusCode).toBe(502)
    expect((res.json() as { error: string }).error).toContain('pricing unavailable')
  })
})

describe('latency', () => {
  it('slows /products and degrades health on average latency', async () => {
    const app = makeShop({ latencyRangeMs: [60, 80], slowMs: 50 })
    await app.inject({ method: 'POST', url: '/chaos/latency' })
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'GET', url: '/products' })
      expect(res.statusCode).toBe(200)
    }
    const health = await app.inject({ method: 'GET', url: '/healthz' })
    expect(health.statusCode).toBe(503)
    expect((health.json() as { failing: string[] }).failing.join(' ')).toContain('latency')
  })
})

describe('oom', () => {
  it('leaks memory on an interval until reset', async () => {
    const app = makeShop({ oomChunkBytes: 1024, oomIntervalMs: 5 })
    await app.inject({ method: 'POST', url: '/chaos/oom' })
    await new Promise((r) => setTimeout(r, 50))
    const state = await app.inject({ method: 'GET', url: '/chaos' })
    expect((state.json() as { leakedBytes: number }).leakedBytes).toBeGreaterThan(0)
    await app.inject({ method: 'POST', url: '/chaos/reset' })
    const after = await app.inject({ method: 'GET', url: '/chaos' })
    expect((after.json() as { leakedBytes: number }).leakedBytes).toBe(0)
  })
})
