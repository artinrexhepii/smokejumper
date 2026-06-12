import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  addMember,
  createIncident,
  createOrganization,
  createProject,
  createSession,
  createTestDb,
  createUser,
  type Db,
} from '@smokejumper/db'
import type { IncidentEvent, NormalizedAlert } from '@smokejumper/plugin-sdk'
import { createBus, type IncidentBus } from '../src/bus.ts'
import { buildServer } from '../src/server.ts'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

function makeAlert(): NormalizedAlert {
  return {
    title: 'api: OOMKilled',
    severity: 'critical',
    service: 'api',
    labels: { env: 'prod' },
    dedupKey: 'api-oom',
    occurredAt: new Date().toISOString(),
    raw: { source: 'test' },
  }
}

async function setup(): Promise<{
  db: Db
  projectId: string
  incidentId: string
  token: string
}> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const user = await createUser(db, {
    email: 'admin@example.com',
    password: 'smokejumper',
    name: 'Admin',
  })
  await addMember(db, { orgId: org.id, userId: user.id, role: 'owner' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  const incident = await createIncident(db, { projectId: project.id, alert: makeAlert() })
  const { token } = await createSession(db, user.id)
  return { db, projectId: project.id, incidentId: incident.id, token }
}

function makeEvent(incidentId: string, projectId: string): IncidentEvent {
  return {
    type: 'investigation.milestone',
    incidentId,
    projectId,
    occurredAt: new Date().toISOString(),
    payload: { phase: 'triage' },
  }
}

describe('GET /api/incidents/:id/events', () => {
  it('requires a session', async () => {
    const { db, incidentId } = await setup()
    const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus() })
    const res = await app.inject({ method: 'GET', url: `/api/incidents/${incidentId}/events` })
    expect(res.statusCode).toBe(401)
  })

  it('404s an unknown incident', async () => {
    const { db, token } = await setup()
    const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus() })
    const res = await app.inject({
      method: 'GET',
      url: `/api/incidents/${randomUUID()}/events`,
      cookies: { sj_session: token },
    })
    expect(res.statusCode).toBe(404)
  })

  it('403s an incident in another org', async () => {
    const { db, token } = await setup()
    const rivalOrg = await createOrganization(db, { name: 'Rival', slug: 'rival' })
    const rivalProject = await createProject(db, {
      orgId: rivalOrg.id,
      name: 'Secret',
      slug: 'secret',
    })
    const foreign = await createIncident(db, { projectId: rivalProject.id, alert: makeAlert() })
    const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus() })
    const res = await app.inject({
      method: 'GET',
      url: `/api/incidents/${foreign.id}/events`,
      cookies: { sj_session: token },
    })
    expect(res.statusCode).toBe(403)
  })

  it('streams matching events and unsubscribes on disconnect', async () => {
    const { db, projectId, incidentId, token } = await setup()
    const bus = createBus()
    let unsubscribed = 0
    const instrumented: IncidentBus = {
      publish: (event) => bus.publish(event),
      subscribe: (fn) => {
        const unsubscribe = bus.subscribe(fn)
        return () => {
          unsubscribed += 1
          unsubscribe()
        }
      },
    }
    const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: instrumented })
    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const controller = new AbortController()
    try {
      const res = await fetch(`${address}/api/incidents/${incidentId}/events`, {
        headers: { cookie: `sj_session=${token}` },
        signal: controller.signal,
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream')

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      async function readUntil(marker: string): Promise<void> {
        while (!buffer.includes(marker)) {
          const { value, done } = await reader.read()
          if (done) throw new Error('stream ended before marker')
          buffer += decoder.decode(value, { stream: true })
        }
      }

      await readUntil(': connected\n\n')
      instrumented.publish(makeEvent('other-incident', projectId))
      instrumented.publish(makeEvent(incidentId, projectId))
      await readUntil(`"incidentId":"${incidentId}"`)
      expect(buffer).not.toContain('other-incident')

      const frame = buffer.split('\n\n').find((part) => part.startsWith('data: '))
      const event = JSON.parse(frame!.slice('data: '.length)) as IncidentEvent
      expect(event.type).toBe('investigation.milestone')
      expect(event.payload).toEqual({ phase: 'triage' })

      await reader.cancel()
      controller.abort()
      await vi.waitFor(() => expect(unsubscribed).toBe(1))
    } finally {
      await app.close()
    }
  })
})
