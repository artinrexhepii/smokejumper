import { describe, expect, it, vi } from 'vitest'
import {
  addMember,
  createOrganization,
  createProject,
  createSession,
  createTestDb,
  createUser,
  type Db,
} from '@smokejumper/db'
import type { IncidentEvent } from '@smokejumper/plugin-sdk'
import { createBus, type IncidentBus } from '../src/bus.ts'
import { buildServer } from '../src/server.ts'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

async function setup(): Promise<{ db: Db; projectId: string; token: string }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const user = await createUser(db, {
    email: 'admin@example.com',
    password: 'smokejumper',
    name: 'Admin',
  })
  await addMember(db, { orgId: org.id, userId: user.id, role: 'owner' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  const { token } = await createSession(db, user.id)
  return { db, projectId: project.id, token }
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
    const { db } = await setup()
    const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus() })
    const res = await app.inject({ method: 'GET', url: '/api/incidents/inc-1/events' })
    expect(res.statusCode).toBe(401)
  })

  it('streams matching events and unsubscribes on disconnect', async () => {
    const { db, projectId, token } = await setup()
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
      const res = await fetch(`${address}/api/incidents/inc-1/events`, {
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
      instrumented.publish(makeEvent('inc-1', projectId))
      await readUntil('"incidentId":"inc-1"')
      expect(buffer).not.toContain('other-incident')

      const frame = buffer.split('\n\n').find((part) => part.startsWith('data: '))
      const event = JSON.parse(frame!.slice('data: '.length)) as IncidentEvent
      expect(event.type).toBe('investigation.milestone')
      expect(event.payload).toEqual({ phase: 'triage' })

      controller.abort()
      await vi.waitFor(() => expect(unsubscribed).toBe(1))
    } finally {
      await app.close()
    }
  })
})
