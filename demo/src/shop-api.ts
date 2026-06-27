import Fastify, { type FastifyInstance } from 'fastify'

export interface ShopApiOptions {
  workerUrl: string
  selfTraffic?: boolean
  latencyRangeMs?: [number, number]
  slowMs?: number
  oomChunkBytes?: number
  oomIntervalMs?: number
}

const PRODUCTS = [
  { id: 'jump-suit', name: 'Jump Suit' },
  { id: 'parachute', name: 'Parachute' },
  { id: 'pulaski', name: 'Pulaski Axe' },
] as const

const SCENARIOS = ['oom', 'error-storm', 'dependency-outage', 'latency'] as const
type Scenario = (typeof SCENARIOS)[number]

const RING_SIZE = 20
const MIN_SAMPLES = 5
const MAX_ERROR_RATE = 0.3

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createShopApi(opts: ShopApiOptions): FastifyInstance {
  const {
    workerUrl,
    selfTraffic = false,
    latencyRangeMs = [2000, 5000],
    slowMs = 1500,
    oomChunkBytes = 10 * 1024 * 1024,
    oomIntervalMs = 500,
  } = opts

  const app = Fastify()
  const chaos: Record<Scenario, boolean> = {
    oom: false,
    'error-storm': false,
    'dependency-outage': false,
    latency: false,
  }
  const outcomes: Array<{ ok: boolean; ms: number }> = []
  const leak: Buffer[] = []
  let leakedBytes = 0
  let oomTimer: NodeJS.Timeout | undefined
  let trafficTimer: NodeJS.Timeout | undefined

  function record(ok: boolean, ms: number): void {
    outcomes.push({ ok, ms })
    if (outcomes.length > RING_SIZE) outcomes.shift()
  }

  function health(): { ok: boolean; failing: string[] } {
    if (outcomes.length >= MIN_SAMPLES) {
      const failures = outcomes.filter((o) => !o.ok).length
      const rate = failures / outcomes.length
      const avgMs = outcomes.reduce((sum, o) => sum + o.ms, 0) / outcomes.length
      const failing: string[] = []
      if (rate >= MAX_ERROR_RATE) {
        failing.push(`error rate ${Math.round(rate * 100)}% on /products (last ${outcomes.length} requests)`)
      }
      if (avgMs >= slowMs) {
        failing.push(`avg /products latency ${Math.round(avgMs)}ms`)
      }
      if (failing.length > 0) return { ok: false, failing }
    }
    return { ok: true, failing: [] }
  }

  function startOom(): void {
    if (oomTimer) return
    oomTimer = setInterval(() => {
      leak.push(Buffer.alloc(oomChunkBytes, 1))
      leakedBytes += oomChunkBytes
    }, oomIntervalMs)
  }

  function resetChaos(): void {
    for (const scenario of SCENARIOS) chaos[scenario] = false
    if (oomTimer) {
      clearInterval(oomTimer)
      oomTimer = undefined
    }
    leak.length = 0
    leakedBytes = 0
    outcomes.length = 0
  }

  app.get('/healthz', async (_req, reply) => {
    const h = health()
    return reply.code(h.ok ? 200 : 503).send({ service: 'shop-api', ...h })
  })

  app.get('/products', async (_req, reply) => {
    const started = Date.now()
    try {
      if (chaos.latency) {
        const [min, max] = latencyRangeMs
        await sleep(min + Math.random() * (max - min))
      }
      if (chaos['error-storm']) {
        record(false, Date.now() - started)
        return await reply.code(500).send({ error: 'internal error' })
      }
      const products = await Promise.all(
        PRODUCTS.map(async (p) => {
          if (chaos['dependency-outage']) {
            await sleep(500)
            throw new Error('worker timed out after 500ms')
          }
          const res = await fetch(`${workerUrl}/price?id=${p.id}`, { signal: AbortSignal.timeout(500) })
          if (!res.ok) throw new Error(`worker responded ${res.status}`)
          const price = (await res.json()) as { price: number; currency: string }
          return { ...p, price: price.price, currency: price.currency }
        }),
      )
      record(true, Date.now() - started)
      return { products }
    } catch (err) {
      record(false, Date.now() - started)
      return reply.code(502).send({ error: `pricing unavailable: ${(err as Error).message}` })
    }
  })

  app.get('/chaos', async () => ({ scenarios: { ...chaos }, leakedBytes }))

  app.post('/chaos/reset', async () => {
    resetChaos()
    return { reset: true }
  })

  app.post('/chaos/:scenario', async (req, reply) => {
    const { scenario } = req.params as { scenario: string }
    if (!(SCENARIOS as readonly string[]).includes(scenario)) {
      return reply.code(400).send({ error: `unknown scenario "${scenario}"`, known: [...SCENARIOS, 'reset'] })
    }
    chaos[scenario as Scenario] = true
    if (scenario === 'oom') startOom()
    return { injected: scenario }
  })

  if (selfTraffic) {
    // simulated customers so health reflects real outcomes even when nobody is clicking
    trafficTimer = setInterval(() => {
      void app.inject({ method: 'GET', url: '/products' }).catch(() => {})
    }, 1000)
    trafficTimer.unref()
  }

  app.addHook('onClose', async () => {
    if (oomTimer) clearInterval(oomTimer)
    if (trafficTimer) clearInterval(trafficTimer)
  })

  return app
}
