import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  addMember,
  createOrganization,
  createProject,
  createTestDb,
  createUser,
  getIncidentDetail,
  listIncidents,
} from '@smokejumper/db'
import { buildServer, createBus } from '@smokejumper/server'
import { createBuiltinRegistry } from '@smokejumper/plugin-host'
import { createInvestigator } from '@smokejumper/engine'
import { createShopApi } from '../src/shop-api'
import { createWorker } from '../src/worker'
import { createWatchdogState, pollOnce, type WatchdogConfig } from '../src/watchdog'
import { DEMO_INSTANCE_IDS, seedDemoInstances } from '../src/seed-demo'

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

function addressOf(app: FastifyInstance): string {
  const addr = app.server.address()
  if (!addr || typeof addr === 'string') throw new Error('server has no bound address')
  return `http://127.0.0.1:${addr.port}`
}

describe('phase 1 acceptance: chaos to diagnosis, fully offline', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>
  let server: FastifyInstance
  let shopApi: FastifyInstance
  let worker: FastifyInstance
  let projectId: string
  let shopApiUrl: string
  const logs: string[] = []
  const state = createWatchdogState()
  let config: WatchdogConfig

  beforeAll(async () => {
    db = await createTestDb()

    const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
    const user = await createUser(db, { email: 'admin@example.com', password: 'smokejumper', name: 'Admin' })
    await addMember(db, { orgId: org.id, userId: user.id, role: 'owner' })
    const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
    projectId = project.id

    // 127.0.0.1:1 refuses connections instantly: the docker telemetry instance exists
    // (as in the real demo) but is unreachable, exercising the finding-of-absence path offline.
    await seedDemoInstances(db, { projectId, encryptionKey: ENCRYPTION_KEY, dockerHost: 'http://127.0.0.1:1' })

    const bus = createBus()
    const registry = createBuiltinRegistry()
    const investigator = createInvestigator({ db, registry, bus, encryptionKey: ENCRYPTION_KEY, models: 'fake' })
    server = await buildServer({ db, encryptionKey: ENCRYPTION_KEY, bus, registry, investigator })
    await server.listen({ port: 0, host: '127.0.0.1' })

    worker = createWorker()
    await worker.listen({ port: 0, host: '127.0.0.1' })
    shopApi = createShopApi({ workerUrl: addressOf(worker) })
    await shopApi.listen({ port: 0, host: '127.0.0.1' })
    shopApiUrl = addressOf(shopApi)

    config = {
      targets: [
        { name: 'shop-api', url: shopApiUrl, syntheticPath: '/products' },
        { name: 'worker', url: addressOf(worker) },
      ],
      ingestUrl: `${addressOf(server)}/ingest/${DEMO_INSTANCE_IDS.webhook}`,
      token: 'demo-token',
      log: (m) => logs.push(m),
    }
  }, 30_000)

  afterAll(async () => {
    await shopApi?.close()
    await worker?.close()
    await server?.close()
  })

  it('stays quiet while the shop is healthy', async () => {
    const result = await pollOnce(config, state)
    expect(result.alertsSent).toBe(0)
    expect(await listIncidents(db, projectId)).toHaveLength(0)
  })

  it('turns an error storm into exactly one open incident', async () => {
    const inject = await fetch(`${shopApiUrl}/chaos/error-storm`, { method: 'POST' })
    expect(inject.status).toBe(200)

    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${shopApiUrl}/products`)
      expect(res.status).toBe(500)
    }
    const healthz = await fetch(`${shopApiUrl}/healthz`)
    expect(healthz.status).toBe(503)
    const health = (await healthz.json()) as { ok: boolean; failing: string[] }
    expect(health.ok).toBe(false)
    expect(health.failing.join(' ')).toContain('error rate')

    const result = await pollOnce(config, state)
    expect(result.alertsSent).toBe(1)

    const incidents = await listIncidents(db, projectId)
    expect(incidents).toHaveLength(1)
    expect(incidents[0]!.severity).toBe('high')
    expect(incidents[0]!.dedupKey).toBe('shop-api-health')
    expect(incidents[0]!.title).toContain('shop-api')
  }, 20_000)

  it('groups repeat alerts into the same incident', async () => {
    const result = await pollOnce(config, state)
    expect(result.alertsSent).toBe(1)
    const incidents = await listIncidents(db, projectId)
    expect(incidents).toHaveLength(1)
    expect(incidents[0]!.alertCount).toBeGreaterThanOrEqual(2)
  })

  it('investigates automatically and produces a cited diagnosis', async () => {
    const incidents = await listIncidents(db, projectId)
    const incidentId = incidents[0]!.id

    await vi.waitFor(
      async () => {
        const current = await listIncidents(db, projectId)
        expect(current[0]!.status).toBe('diagnosed')
      },
      { timeout: 30_000, interval: 500 },
    )

    const detail = await getIncidentDetail(db, incidentId)
    expect(detail).toBeDefined()
    expect(detail!.investigation).toBeDefined()
    expect(detail!.investigation!.status).toBe('completed')
    expect(detail!.findings.length).toBeGreaterThanOrEqual(1)

    const diagnosis = detail!.diagnosis
    expect(diagnosis).toBeDefined()
    expect(diagnosis!.rootCause.length).toBeGreaterThan(0)
    expect(diagnosis!.confidence).toBeDefined()
    expect(Array.isArray(diagnosis!.evidenceChain)).toBe(true)
    for (const claim of diagnosis!.evidenceChain) {
      // evidence-or-silence: a verified claim must cite evidence records
      if (claim.verified) expect(claim.evidenceIds.length).toBeGreaterThan(0)
    }

    expect(Array.isArray(detail!.evidence)).toBe(true)
    if (detail!.evidence.length > 0) {
      expect(detail!.evidence[0]!.prevHash).toBe('genesis')
    }
  }, 45_000)

  it('recovers after chaos reset', async () => {
    await fetch(`${shopApiUrl}/chaos/reset`, { method: 'POST' })
    const result = await pollOnce(config, state)
    expect(result.alertsSent).toBe(0)
    expect(state.down.has('shop-api')).toBe(false)
    expect(logs.some((m) => m.includes('shop-api recovered'))).toBe(true)
  })
})
