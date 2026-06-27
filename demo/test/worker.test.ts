import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createWorker } from '../src/worker'

describe('worker', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = createWorker()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('reports healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, service: 'worker' })
  })

  it('prices a known product', async () => {
    const res = await app.inject({ method: 'GET', url: '/price?id=parachute' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { id: string; price: number; currency: string }
    expect(body.id).toBe('parachute')
    expect(body.price).toBeGreaterThan(0)
    expect(body.currency).toBe('USD')
  })

  it('404s an unknown product', async () => {
    const res = await app.inject({ method: 'GET', url: '/price?id=flamethrower' })
    expect(res.statusCode).toBe(404)
  })
})
