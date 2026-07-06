import {
  appendAudit,
  createRunbook,
  deleteRunbook,
  getProject,
  getRunbook,
  listRunbooks,
  setRunbookChunkCount,
  type Db,
} from '@smokejumper/db'
import { embedRunbook, type Embedder } from '@smokejumper/engine'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

export interface RunbookRoutesDeps {
  db: Db
  embedder?: Embedder
  fetchImpl?: typeof fetch
}

const createBody = z.object({
  title: z.string().min(1),
  sourceKind: z.enum(['upload', 'paste', 'url']),
  sourceRef: z.string().optional(),
  content: z.string().optional(),
})

export function registerRunbookRoutes(app: FastifyInstance, deps: RunbookRoutesDeps): void {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch

  app.get('/api/projects/:projectId/runbooks', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await getProject(deps.db, projectId)
    if (!project) return reply.code(404).send({ error: 'not found' })
    if (!request.auth!.orgIds.includes(project.orgId)) return reply.code(403).send({ error: 'forbidden' })
    return listRunbooks(deps.db, projectId)
  })

  app.post('/api/projects/:projectId/runbooks', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await getProject(deps.db, projectId)
    if (!project) return reply.code(404).send({ error: 'not found' })
    if (!request.auth!.orgIds.includes(project.orgId)) return reply.code(403).send({ error: 'forbidden' })
    const parsed = createBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })

    let content: string
    if (parsed.data.sourceKind === 'url') {
      if (!parsed.data.sourceRef) {
        return reply.code(400).send({ error: 'sourceRef is required for a url runbook' })
      }
      let res: Response
      try {
        res = await fetchImpl(parsed.data.sourceRef)
      } catch {
        return reply.code(400).send({ error: `could not fetch ${parsed.data.sourceRef}` })
      }
      if (!res.ok) return reply.code(400).send({ error: `could not fetch ${parsed.data.sourceRef}` })
      content = await res.text()
    } else {
      if (!parsed.data.content) return reply.code(400).send({ error: 'content is required' })
      content = parsed.data.content
    }

    const runbook = await createRunbook(deps.db, {
      projectId,
      title: parsed.data.title,
      sourceKind: parsed.data.sourceKind,
      sourceRef: parsed.data.sourceRef,
      content,
    })
    const chunkCount = await embedRunbook({
      db: deps.db,
      embedder: deps.embedder,
      runbookId: runbook.id,
      projectId,
      title: runbook.title,
      content,
    })
    await setRunbookChunkCount(deps.db, runbook.id, chunkCount)
    await appendAudit(deps.db, {
      orgId: project.orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'runbook.create',
      subjectType: 'runbook',
      subjectId: runbook.id,
      detail: { title: runbook.title, sourceKind: runbook.sourceKind },
    })
    return reply.code(201).send({ ...runbook, chunkCount })
  })

  app.get('/api/runbooks/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runbook = await getRunbook(deps.db, id)
    if (!runbook) return reply.code(404).send({ error: 'not found' })
    const project = await getProject(deps.db, runbook.projectId)
    if (!project || !request.auth!.orgIds.includes(project.orgId)) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    return runbook
  })

  app.delete('/api/runbooks/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runbook = await getRunbook(deps.db, id)
    if (!runbook) return reply.code(404).send({ error: 'not found' })
    const project = await getProject(deps.db, runbook.projectId)
    if (!project || !request.auth!.orgIds.includes(project.orgId)) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    await deleteRunbook(deps.db, id)
    await appendAudit(deps.db, {
      orgId: project.orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'runbook.delete',
      subjectType: 'runbook',
      subjectId: id,
      detail: { title: runbook.title },
    })
    return reply.code(204).send()
  })
}
