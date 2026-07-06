import {
  createIncident,
  createReview,
  findOpenIncidentByDedupKey,
  getIncident,
  getReviewByIncident,
  recordAlert,
  updateIncidentStatus,
  type Db,
  type Incident,
} from '@smokejumper/db'
import { draftIncidentReview, type ModelDriver } from '@smokejumper/engine'
import type { NormalizedAlert } from '@smokejumper/plugin-sdk'
import type { IncidentBus } from './bus.ts'

export interface IncidentManager {
  ingest(projectId: string, alerts: NormalizedAlert[]): Promise<Array<{ incident: Incident; isNew: boolean }>>
  resolve(incidentId: string): Promise<void>
}

export function createIncidentManager(opts: {
  db: Db
  bus: IncidentBus
  windowMs?: number
  driver?: ModelDriver
}): IncidentManager {
  const { db, bus, windowMs = 900_000, driver } = opts
  return {
    async ingest(projectId, alerts) {
      const results: Array<{ incident: Incident; isNew: boolean }> = []
      for (const alert of alerts) {
        const existing = await findOpenIncidentByDedupKey(db, projectId, alert.dedupKey, windowMs)
        if (existing) {
          await recordAlert(db, existing.id, alert)
          const updated = (await getIncident(db, existing.id)) ?? existing
          results.push({ incident: updated, isNew: false })
        } else {
          const incident = await createIncident(db, { projectId, alert })
          bus.publish({
            type: 'incident.opened',
            incidentId: incident.id,
            projectId,
            occurredAt: new Date().toISOString(),
            payload: { title: incident.title, severity: incident.severity, service: incident.service },
          })
          results.push({ incident, isNew: true })
        }
      }
      return results
    },
    async resolve(incidentId) {
      await updateIncidentStatus(db, incidentId, 'resolved')
      const incident = await getIncident(db, incidentId)
      if (incident) {
        bus.publish({
          type: 'incident.resolved',
          incidentId,
          projectId: incident.projectId,
          occurredAt: new Date().toISOString(),
          payload: {},
        })
      }
      if (!driver) return
      try {
        const existing = await getReviewByIncident(db, incidentId)
        if (!existing) {
          const generated = await draftIncidentReview({ db, incidentId, driver })
          await createReview(db, { incidentId, generated })
        }
      } catch (err) {
        console.error(`[server] failed to draft a post-incident review for ${incidentId}`, err)
      }
    },
  }
}
