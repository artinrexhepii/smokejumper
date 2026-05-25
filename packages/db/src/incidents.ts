import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { NormalizedAlert } from '@smokejumper/plugin-sdk'
import type { Db } from './db.ts'
import { alerts, incidents, type Incident, type IncidentStatus } from './schema.ts'

export async function findOpenIncidentByDedupKey(
  db: Db,
  projectId: string,
  dedupKey: string,
  windowMs: number,
): Promise<Incident | undefined> {
  const cutoff = new Date(Date.now() - windowMs)
  const [incident] = await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.projectId, projectId),
        eq(incidents.dedupKey, dedupKey),
        inArray(incidents.status, ['open', 'investigating']),
        gt(incidents.lastAlertAt, cutoff),
      ),
    )
    .orderBy(desc(incidents.lastAlertAt))
    .limit(1)
  return incident
}

export async function createIncident(
  db: Db,
  input: { projectId: string; alert: NormalizedAlert },
): Promise<Incident> {
  return db.transaction(async (tx) => {
    const [incident] = await tx
      .insert(incidents)
      .values({
        projectId: input.projectId,
        severity: input.alert.severity,
        title: input.alert.title,
        service: input.alert.service,
        dedupKey: input.alert.dedupKey,
        labels: input.alert.labels,
      })
      .returning()
    await tx.insert(alerts).values({ incidentId: incident!.id, payload: input.alert })
    return incident!
  })
}

export async function recordAlert(db: Db, incidentId: string, alert: NormalizedAlert): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(alerts).values({ incidentId, payload: alert })
    await tx
      .update(incidents)
      .set({ alertCount: sql`${incidents.alertCount} + 1`, lastAlertAt: new Date() })
      .where(eq(incidents.id, incidentId))
  })
}

export async function getIncident(db: Db, incidentId: string): Promise<Incident | undefined> {
  const [incident] = await db.select().from(incidents).where(eq(incidents.id, incidentId))
  return incident
}

export async function listIncidents(db: Db, projectId: string): Promise<Incident[]> {
  return db
    .select()
    .from(incidents)
    .where(eq(incidents.projectId, projectId))
    .orderBy(desc(incidents.openedAt))
}

export async function updateIncidentStatus(
  db: Db,
  incidentId: string,
  status: IncidentStatus,
): Promise<void> {
  await db
    .update(incidents)
    .set(status === 'resolved' ? { status, resolvedAt: new Date() } : { status })
    .where(eq(incidents.id, incidentId))
}
