import { getIncident, getProject } from '@smokejumper/db'
import type { FastifyInstance } from 'fastify'
import type { ServerDeps } from './server.ts'

const HEARTBEAT_MS = 15_000

export function registerSseRoute(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/incidents/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string }
    const incident = await getIncident(deps.db, id)
    if (!incident) return reply.code(404).send({ error: 'not found' })
    const project = await getProject(deps.db, incident.projectId)
    if (!project || !request.auth!.orgIds.includes(project.orgId)) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000',
      'access-control-allow-credentials': 'true',
    })
    reply.raw.write(': connected\n\n')
    const unsubscribe = deps.bus.subscribe((event) => {
      if (event.incidentId === id) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      }
    })
    const heartbeat = setInterval(() => {
      reply.raw.write(': ping\n\n')
    }, HEARTBEAT_MS)
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })
}
