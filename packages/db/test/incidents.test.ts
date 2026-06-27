import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { NormalizedAlert } from '@smokejumper/plugin-sdk'
import {
  alerts,
  createIncident,
  createOrganization,
  createProject,
  createTestDb,
  findOpenIncidentByDedupKey,
  getIncident,
  incidents,
  listIncidents,
  recordAlert,
  updateIncidentStatus,
  type Db,
} from '../src/index.ts'

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

async function setup(): Promise<{ db: Db; projectId: string }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  return { db, projectId: project.id }
}

describe('incidents', () => {
  it('creates an incident from a normalized alert and stores the alert', async () => {
    const { db, projectId } = await setup()
    const incident = await createIncident(db, { projectId, alert: makeAlert() })
    expect(incident).toMatchObject({
      projectId,
      status: 'open',
      severity: 'critical',
      title: 'api: OOMKilled',
      service: 'api',
      dedupKey: 'api-oom',
      labels: { env: 'prod' },
      alertCount: 1,
      resolvedAt: null,
    })
    const stored = await db.select().from(alerts).where(eq(alerts.incidentId, incident.id))
    expect(stored).toHaveLength(1)
    expect(stored[0]!.payload).toMatchObject({ dedupKey: 'api-oom' })
  })

  it('recordAlert bumps alertCount and lastAlertAt and appends the alert row', async () => {
    const { db, projectId } = await setup()
    const incident = await createIncident(db, { projectId, alert: makeAlert() })
    await recordAlert(db, incident.id, makeAlert())
    const updated = await getIncident(db, incident.id)
    expect(updated?.alertCount).toBe(2)
    expect(updated!.lastAlertAt.getTime()).toBeGreaterThanOrEqual(incident.lastAlertAt.getTime())
    const stored = await db.select().from(alerts).where(eq(alerts.incidentId, incident.id))
    expect(stored).toHaveLength(2)
  })

  it('finds open incidents by dedup key within the window', async () => {
    const { db, projectId } = await setup()
    const incident = await createIncident(db, { projectId, alert: makeAlert() })
    const found = await findOpenIncidentByDedupKey(db, projectId, 'api-oom', 900_000)
    expect(found?.id).toBe(incident.id)
    expect(await findOpenIncidentByDedupKey(db, projectId, 'other-key', 900_000)).toBeUndefined()
  })

  it('matches investigating incidents but not resolved ones', async () => {
    const { db, projectId } = await setup()
    const incident = await createIncident(db, { projectId, alert: makeAlert() })
    await updateIncidentStatus(db, incident.id, 'investigating')
    expect((await findOpenIncidentByDedupKey(db, projectId, 'api-oom', 900_000))?.id).toBe(incident.id)
    await updateIncidentStatus(db, incident.id, 'resolved')
    expect(await findOpenIncidentByDedupKey(db, projectId, 'api-oom', 900_000)).toBeUndefined()
    expect((await getIncident(db, incident.id))?.resolvedAt).toBeInstanceOf(Date)
  })

  it('matches diagnosed incidents (still unresolved)', async () => {
    const { db, projectId } = await setup()
    const incident = await createIncident(db, { projectId, alert: makeAlert() })
    await updateIncidentStatus(db, incident.id, 'diagnosed')
    const found = await findOpenIncidentByDedupKey(db, projectId, 'api-oom', 900_000)
    expect(found?.id).toBe(incident.id)
  })

  it('ignores incidents whose last alert is outside the window', async () => {
    const { db, projectId } = await setup()
    const incident = await createIncident(db, { projectId, alert: makeAlert() })
    await db
      .update(incidents)
      .set({ lastAlertAt: new Date(Date.now() - 3_600_000) })
      .where(eq(incidents.id, incident.id))
    expect(await findOpenIncidentByDedupKey(db, projectId, 'api-oom', 900_000)).toBeUndefined()
    expect(await findOpenIncidentByDedupKey(db, projectId, 'api-oom', 7_200_000)).toBeDefined()
  })

  it('lists all incidents for a project', async () => {
    const { db, projectId } = await setup()
    const first = await createIncident(db, { projectId, alert: makeAlert({ dedupKey: 'k1' }) })
    const second = await createIncident(db, { projectId, alert: makeAlert({ dedupKey: 'k2' }) })
    const listed = await listIncidents(db, projectId)
    expect(listed.map((i) => i.id)).toHaveLength(2)
    expect(listed.map((i) => i.id)).toContain(first.id)
    expect(listed.map((i) => i.id)).toContain(second.id)
  })
})
