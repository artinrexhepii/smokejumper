import {
  appendAudit,
  getDiagnosis,
  getIncident,
  getIncidentDetail,
  getInvestigation,
  getProject,
  listAudit,
  listIncidents,
  listProjects,
  setDiagnosisVerdict,
} from '@smokejumper/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ServerDeps } from './server.ts'

const verdictBody = z.object({
  verdict: z.enum(['confirmed', 'rejected', 'partial']),
  note: z.string().optional(),
})

export function registerDataRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/orgs/:orgId/projects', async (request, reply) => {
    const { orgId } = request.params as { orgId: string }
    if (!request.auth!.orgIds.includes(orgId)) return reply.code(403).send({ error: 'forbidden' })
    return listProjects(deps.db, orgId)
  })

  app.get('/api/projects/:projectId/incidents', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await getProject(deps.db, projectId)
    if (!project) return reply.code(404).send({ error: 'not found' })
    if (!request.auth!.orgIds.includes(project.orgId)) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    return listIncidents(deps.db, projectId)
  })

  app.get('/api/incidents/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const detail = await getIncidentDetail(deps.db, id)
    if (!detail) return reply.code(404).send({ error: 'not found' })
    const project = await getProject(deps.db, detail.incident.projectId)
    if (!project || !request.auth!.orgIds.includes(project.orgId)) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    return detail
  })

  app.post('/api/diagnoses/:id/verdict', async (request, reply) => {
    const { id } = request.params as { id: string }
    const diagnosis = await getDiagnosis(deps.db, id)
    if (!diagnosis) return reply.code(404).send({ error: 'not found' })
    const investigation = await getInvestigation(deps.db, diagnosis.investigationId)
    const incident = investigation ? await getIncident(deps.db, investigation.incidentId) : undefined
    const project = incident ? await getProject(deps.db, incident.projectId) : undefined
    if (!project || !request.auth!.orgIds.includes(project.orgId)) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    const parsed = verdictBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })
    await setDiagnosisVerdict(deps.db, id, parsed.data)
    await appendAudit(deps.db, {
      orgId: project.orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'diagnosis.verdict',
      subjectType: 'diagnosis',
      subjectId: id,
      detail: { verdict: parsed.data.verdict, note: parsed.data.note ?? null },
    })
    return reply.code(204).send()
  })

  app.get('/api/orgs/:orgId/audit', async (request, reply) => {
    const { orgId } = request.params as { orgId: string }
    if (!request.auth!.orgIds.includes(orgId)) return reply.code(403).send({ error: 'forbidden' })
    return listAudit(deps.db, { orgId })
  })
}
