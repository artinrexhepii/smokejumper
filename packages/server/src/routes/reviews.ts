import {
  appendAudit,
  approveReview,
  getIncident,
  getIncidentDetail,
  getProject,
  getReviewByIncident,
  updateReview,
  upsertGenerated,
  type Db,
  type Incident,
  type ReviewBody,
} from '@smokejumper/db'
import { draftIncidentReview, type ModelDriver } from '@smokejumper/engine'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

export interface ReviewRoutesDeps {
  db: Db
  driver: ModelDriver
}

const reviewBodySchema = z.object({
  summary: z.string(),
  timeline: z.array(z.object({ at: z.string(), text: z.string() })),
  rootCause: z.string(),
  contributingFactors: z.array(z.string()),
  actionItems: z.array(z.string()),
  evidenceRefs: z.array(z.string()),
})

const patchBody = z.object({ edited: reviewBodySchema })

function renderMarkdown(incident: Incident, body: ReviewBody): string {
  const lines = [
    `# Post-incident review: ${incident.title}`,
    '',
    `Service: ${incident.service} — Severity: ${incident.severity}`,
    '',
    '## Summary',
    '',
    body.summary,
    '',
    '## Timeline',
    '',
    ...(body.timeline.length > 0
      ? body.timeline.map((entry) => `- **${entry.at}** — ${entry.text}`)
      : ['(no timeline entries)']),
    '',
    '## Root cause',
    '',
    body.rootCause,
    '',
    '## Contributing factors',
    '',
    ...(body.contributingFactors.length > 0 ? body.contributingFactors.map((f) => `- ${f}`) : ['(none noted)']),
    '',
    '## Action items',
    '',
    ...(body.actionItems.length > 0 ? body.actionItems.map((item) => `- ${item}`) : ['(none noted)']),
    '',
    '## Cited evidence',
    '',
    ...(body.evidenceRefs.length > 0 ? body.evidenceRefs.map((id) => `- ${id}`) : ['(none cited)']),
    '',
  ]
  return lines.join('\n')
}

async function loadIncidentOrg(
  db: Db,
  incidentId: string,
): Promise<{ incident: Incident; orgId: string } | undefined> {
  const incident = await getIncident(db, incidentId)
  if (!incident) return undefined
  const project = await getProject(db, incident.projectId)
  if (!project) return undefined
  return { incident, orgId: project.orgId }
}

export function registerReviewRoutes(app: FastifyInstance, deps: ReviewRoutesDeps): void {
  async function authorize(
    request: FastifyRequest,
    incidentId: string,
  ): Promise<{ incident: Incident; orgId: string } | { error: 404 | 403 }> {
    const found = await loadIncidentOrg(deps.db, incidentId)
    if (!found) return { error: 404 }
    if (!request.auth!.orgIds.includes(found.orgId)) return { error: 403 }
    return found
  }

  app.get('/api/incidents/:id/review', async (request, reply) => {
    const { id } = request.params as { id: string }
    const ctx = await authorize(request, id)
    if ('error' in ctx) return reply.code(ctx.error).send({ error: ctx.error === 404 ? 'not found' : 'forbidden' })
    const review = await getReviewByIncident(deps.db, id)
    if (!review) return reply.code(404).send({ error: 'not found' })
    return review
  })

  app.post('/api/incidents/:id/review', async (request, reply) => {
    const { id } = request.params as { id: string }
    const ctx = await authorize(request, id)
    if ('error' in ctx) return reply.code(ctx.error).send({ error: ctx.error === 404 ? 'not found' : 'forbidden' })
    const generated = await draftIncidentReview({ db: deps.db, incidentId: id, driver: deps.driver })
    const review = await upsertGenerated(deps.db, id, generated)
    await appendAudit(deps.db, {
      orgId: ctx.orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'review.generate',
      subjectType: 'incident_review',
      subjectId: review.id,
      detail: {},
    })
    return reply.code(201).send(review)
  })

  app.patch('/api/incidents/:id/review', async (request, reply) => {
    const { id } = request.params as { id: string }
    const ctx = await authorize(request, id)
    if ('error' in ctx) return reply.code(ctx.error).send({ error: ctx.error === 404 ? 'not found' : 'forbidden' })
    const existing = await getReviewByIncident(deps.db, id)
    if (!existing) return reply.code(404).send({ error: 'not found' })
    const parsed = patchBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })
    const detail = await getIncidentDetail(deps.db, id)
    const knownIds = new Set((detail?.evidence ?? []).map((record) => record.id))
    const edited: ReviewBody = {
      ...parsed.data.edited,
      evidenceRefs: [...new Set(parsed.data.edited.evidenceRefs)].filter((evidenceId) => knownIds.has(evidenceId)),
    }
    await updateReview(deps.db, id, edited)
    await appendAudit(deps.db, {
      orgId: ctx.orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'review.edit',
      subjectType: 'incident_review',
      subjectId: existing.id,
      detail: {},
    })
    return getReviewByIncident(deps.db, id)
  })

  app.post('/api/incidents/:id/review/approve', async (request, reply) => {
    const { id } = request.params as { id: string }
    const ctx = await authorize(request, id)
    if ('error' in ctx) return reply.code(ctx.error).send({ error: ctx.error === 404 ? 'not found' : 'forbidden' })
    const existing = await getReviewByIncident(deps.db, id)
    if (!existing) return reply.code(404).send({ error: 'not found' })
    await approveReview(deps.db, id, request.auth!.user.id)
    await appendAudit(deps.db, {
      orgId: ctx.orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'review.approve',
      subjectType: 'incident_review',
      subjectId: existing.id,
      detail: {},
    })
    return getReviewByIncident(deps.db, id)
  })

  app.get('/api/incidents/:id/review/export', async (request, reply) => {
    const { id } = request.params as { id: string }
    const ctx = await authorize(request, id)
    if ('error' in ctx) return reply.code(ctx.error).send({ error: ctx.error === 404 ? 'not found' : 'forbidden' })
    const review = await getReviewByIncident(deps.db, id)
    if (!review) return reply.code(404).send({ error: 'not found' })
    const body = review.edited ?? review.generated
    reply.header('content-type', 'text/markdown; charset=utf-8')
    return renderMarkdown(ctx.incident, body)
  })
}
