import Fastify, { type FastifyInstance } from 'fastify'

const PRICES: Record<string, number> = {
  'jump-suit': 289,
  parachute: 1450,
  pulaski: 89,
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createWorker(): FastifyInstance {
  const app = Fastify()

  app.get('/healthz', async () => ({ ok: true, service: 'worker', failing: [] }))

  app.get('/price', async (req, reply) => {
    const { id } = req.query as { id?: string }
    const price = id ? PRICES[id] : undefined
    if (price === undefined) {
      return reply.code(404).send({ error: `unknown product "${id ?? ''}"` })
    }
    await sleep(10 + Math.random() * 20)
    return { id, price, currency: 'USD' }
  })

  return app
}
