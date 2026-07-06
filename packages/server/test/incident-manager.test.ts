import { describe, expect, it } from 'vitest'
import {
  createOrganization,
  createProject,
  createTestDb,
  getIncident,
  getReviewByIncident,
  updateIncidentStatus,
  type Db,
} from '@smokejumper/db'
import { createFakeDriver } from '@smokejumper/engine'
import type { IncidentEvent, NormalizedAlert } from '@smokejumper/plugin-sdk'
import { createBus, type IncidentBus } from '../src/bus.ts'
import { createIncidentManager } from '../src/incident-manager.ts'

function makeAlert(overrides: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    title: 'api: OOMKilled',
    severity: 'critical',
    service: 'api',
    labels: { env: 'prod' },
    dedupKey: 'api-oom',
    occurredAt: new Date().toISOString(),
    raw: { source: 'test' },
    ...overrides,
  }
}

async function setup(): Promise<{
  db: Db
  projectId: string
  bus: IncidentBus
  events: IncidentEvent[]
}> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  const bus = createBus()
  const events: IncidentEvent[] = []
  bus.subscribe((event) => events.push(event))
  return { db, projectId: project.id, bus, events }
}

describe('createIncidentManager', () => {
  it('creates a new incident and publishes incident.opened', async () => {
    const { db, projectId, bus, events } = await setup()
    const manager = createIncidentManager({ db, bus })
    const results = await manager.ingest(projectId, [makeAlert()])
    expect(results).toHaveLength(1)
    expect(results[0]!.isNew).toBe(true)
    expect(results[0]!.incident.status).toBe('open')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'incident.opened',
      incidentId: results[0]!.incident.id,
      projectId,
      payload: { title: 'api: OOMKilled', severity: 'critical', service: 'api' },
    })
  })

  it('dedups repeats within the window without republishing', async () => {
    const { db, projectId, bus, events } = await setup()
    const manager = createIncidentManager({ db, bus })
    const [first] = await manager.ingest(projectId, [makeAlert()])
    const [second] = await manager.ingest(projectId, [makeAlert()])
    expect(second!.isNew).toBe(false)
    expect(second!.incident.id).toBe(first!.incident.id)
    expect(second!.incident.alertCount).toBe(2)
    expect(events).toHaveLength(1)
  })

  it('dedups against investigating incidents too', async () => {
    const { db, projectId, bus, events } = await setup()
    const manager = createIncidentManager({ db, bus })
    const [first] = await manager.ingest(projectId, [makeAlert()])
    await updateIncidentStatus(db, first!.incident.id, 'investigating')
    const [second] = await manager.ingest(projectId, [makeAlert()])
    expect(second!.isNew).toBe(false)
    expect(events).toHaveLength(1)
  })

  it('opens a fresh incident after the window elapses', async () => {
    const { db, projectId, bus, events } = await setup()
    const manager = createIncidentManager({ db, bus, windowMs: 20 })
    const [first] = await manager.ingest(projectId, [makeAlert()])
    await new Promise((resolve) => setTimeout(resolve, 40))
    const [second] = await manager.ingest(projectId, [makeAlert()])
    expect(second!.isNew).toBe(true)
    expect(second!.incident.id).not.toBe(first!.incident.id)
    expect(events).toHaveLength(2)
  })

  it('opens a fresh incident when the previous one is resolved', async () => {
    const { db, projectId, bus, events } = await setup()
    const manager = createIncidentManager({ db, bus })
    const [first] = await manager.ingest(projectId, [makeAlert()])
    await updateIncidentStatus(db, first!.incident.id, 'resolved')
    const [second] = await manager.ingest(projectId, [makeAlert()])
    expect(second!.isNew).toBe(true)
    expect(second!.incident.id).not.toBe(first!.incident.id)
    expect(events).toHaveLength(2)
  })

  it('processes a batch of alerts in order', async () => {
    const { db, projectId, bus, events } = await setup()
    const manager = createIncidentManager({ db, bus })
    const results = await manager.ingest(projectId, [
      makeAlert({ dedupKey: 'k1' }),
      makeAlert({ dedupKey: 'k2' }),
      makeAlert({ dedupKey: 'k1' }),
    ])
    expect(results.map((r) => r.isNew)).toEqual([true, true, false])
    expect(results[2]!.incident.id).toBe(results[0]!.incident.id)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'incident.opened' })
    expect(events[1]).toMatchObject({ type: 'incident.opened' })
  })
})

describe('resolve', () => {
  it('marks the incident resolved and publishes incident.resolved', async () => {
    const { db, projectId, bus, events } = await setup()
    const manager = createIncidentManager({ db, bus })
    const [opened] = await manager.ingest(projectId, [makeAlert()])
    const incident = opened!.incident
    await manager.resolve(incident.id)
    expect((await getIncident(db, incident.id))?.status).toBe('resolved')
    expect(events.at(-1)).toMatchObject({ type: 'incident.resolved', incidentId: incident.id, projectId })
  })

  it('does nothing to reviews when no driver is configured', async () => {
    const { db, projectId, bus } = await setup()
    const manager = createIncidentManager({ db, bus })
    const [opened] = await manager.ingest(projectId, [makeAlert()])
    const incident = opened!.incident
    await manager.resolve(incident.id)
    expect(await getReviewByIncident(db, incident.id)).toBeUndefined()
  })

  it('drafts a review when a driver is configured and none exists yet', async () => {
    const { db, projectId, bus } = await setup()
    const manager = createIncidentManager({ db, bus, driver: createFakeDriver() })
    const [opened] = await manager.ingest(projectId, [makeAlert()])
    const incident = opened!.incident
    await manager.resolve(incident.id)
    const review = await getReviewByIncident(db, incident.id)
    expect(review?.status).toBe('draft')
    expect(review?.generated.rootCause).toContain('No diagnosis')
  })

  it('does not draft a second review when one already exists', async () => {
    const { db, projectId, bus } = await setup()
    let calls = 0
    const countingDriver = {
      ...createFakeDriver(),
      async draftReview(input: Parameters<ReturnType<typeof createFakeDriver>['draftReview']>[0]) {
        calls += 1
        return createFakeDriver().draftReview(input)
      },
    }
    const manager = createIncidentManager({ db, bus, driver: countingDriver })
    const [opened] = await manager.ingest(projectId, [makeAlert()])
    const incident = opened!.incident
    await manager.resolve(incident.id)
    await manager.resolve(incident.id)
    expect(calls).toBe(1)
  })

  it('still resolves the incident when drafting the review throws', async () => {
    const { db, projectId, bus } = await setup()
    const throwingDriver = {
      ...createFakeDriver(),
      async draftReview(): Promise<never> {
        throw new Error('model unavailable')
      },
    }
    const manager = createIncidentManager({ db, bus, driver: throwingDriver })
    const [opened] = await manager.ingest(projectId, [makeAlert()])
    const incident = opened!.incident
    await expect(manager.resolve(incident.id)).resolves.toBeUndefined()
    expect((await getIncident(db, incident.id))?.status).toBe('resolved')
    expect(await getReviewByIncident(db, incident.id)).toBeUndefined()
  })
})
