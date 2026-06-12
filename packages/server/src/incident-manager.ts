import {
  createIncident,
  findOpenIncidentByDedupKey,
  getIncident,
  recordAlert,
  type Db,
  type Incident,
} from '@smokejumper/db'
import type { NormalizedAlert } from '@smokejumper/plugin-sdk'
import type { IncidentBus } from './bus.ts'

export interface IncidentManager {
  ingest(projectId: string, alerts: NormalizedAlert[]): Promise<Array<{ incident: Incident; isNew: boolean }>>
}

export function createIncidentManager(opts: {
  db: Db
  bus: IncidentBus
  windowMs?: number
}): IncidentManager {
  const { db, bus, windowMs = 900_000 } = opts
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
  }
}
