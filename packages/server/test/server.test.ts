import { describe, expect, it } from 'vitest'
import {
  addMember,
  createOrganization,
  createTestDb,
  createUser,
  type Db,
} from '@smokejumper/db'
import type { IncidentEvent } from '@smokejumper/plugin-sdk'
import type { FastifyInstance } from 'fastify'
import { createBus } from '../src/bus.ts'
import { buildServer } from '../src/server.ts'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

async function setup(): Promise<{ db: Db; app: FastifyInstance; orgId: string }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const user = await createUser(db, {
    email: 'admin@example.com',
    password: 'smokejumper',
    name: 'Admin',
  })
  await addMember(db, { orgId: org.id, userId: user.id, role: 'owner' })
  const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus() })
  return { db, app, orgId: org.id }
}

describe('createBus', () => {
  it('delivers events to subscribers until unsubscribed', () => {
    const bus = createBus()
    const seen: IncidentEvent[] = []
    const unsubscribe = bus.subscribe((event) => seen.push(event))
    const event: IncidentEvent = {
      type: 'incident.opened',
      incidentId: 'inc-1',
      projectId: 'proj-1',
      occurredAt: new Date().toISOString(),
      payload: {},
    }
    bus.publish(event)
    unsubscribe()
    bus.publish(event)
    expect(seen).toHaveLength(1)
  })
})

describe('buildServer', () => {
  it('serves healthz publicly', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('enables cors for the dashboard origin with credentials', async () => {
    const { app } = await setup()
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'http://localhost:3000' },
    })
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('rejects api requests without a session', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/api/me' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects bad credentials and malformed login bodies', async () => {
    const { app } = await setup()
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'wrong' },
    })
    expect(bad.statusCode).toBe(401)
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@example.com' },
    })
    expect(malformed.statusCode).toBe(400)
  })

  it('logs in, reads /api/me, and logs out', async () => {
    const { app, orgId } = await setup()
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'smokejumper' },
    })
    expect(login.statusCode).toBe(200)
    expect(login.json().user.email).toBe('admin@example.com')
    expect(login.json().user.passwordHash).toBeUndefined()
    const cookie = login.cookies.find((c) => c.name === 'sj_session')
    expect(cookie).toBeDefined()
    expect(cookie!.httpOnly).toBe(true)

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { sj_session: cookie!.value },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().user.email).toBe('admin@example.com')
    expect(me.json().orgs.map((o: { id: string }) => o.id)).toEqual([orgId])

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { sj_session: cookie!.value },
    })
    expect(logout.statusCode).toBe(204)

    const meAfter = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { sj_session: cookie!.value },
    })
    expect(meAfter.statusCode).toBe(401)
  })
})
