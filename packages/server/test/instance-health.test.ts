import { describe, expect, it } from 'vitest'
import {
  addMember,
  createOrganization,
  createProject,
  createSession,
  createTestDb,
  createUser,
  type Db,
} from '@smokejumper/db'
import { createBuiltinRegistry } from '@smokejumper/plugin-host'
import type { FastifyInstance } from 'fastify'
import { buildServer, createBus } from '../src/index.ts'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

interface Ctx {
  db: Db
  app: FastifyInstance
  projectId: string
  owner: { sj_session: string }
  member: { sj_session: string }
}

async function setup(): Promise<Ctx> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  const ownerUser = await createUser(db, { email: 'owner@example.com', password: 'smokejumper', name: 'Owner' })
  const memberUser = await createUser(db, { email: 'member@example.com', password: 'smokejumper', name: 'Member' })
  await addMember(db, { orgId: org.id, userId: ownerUser.id, role: 'owner' })
  await addMember(db, { orgId: org.id, userId: memberUser.id, role: 'member' })
  const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus(), registry: createBuiltinRegistry() })
  return {
    db,
    app,
    projectId: project.id,
    owner: { sj_session: (await createSession(db, ownerUser.id)).token },
    member: { sj_session: (await createSession(db, memberUser.id)).token },
  }
}

async function createHttpInstance(ctx: Ctx): Promise<{ id: string }> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/projects/${ctx.projectId}/instances`,
    cookies: ctx.owner,
    payload: { pluginId: 'http', name: 'HTTP', config: {}, credentials: {} },
  })
  return res.json()
}

describe('POST /api/instances/:id/health', () => {
  it('returns { ok: true } for a healthy telemetry instance', async () => {
    const ctx = await setup()
    const instance = await createHttpInstance(ctx)
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/instances/${instance.id}/health`,
      cookies: ctx.owner,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('forbids plain members', async () => {
    const ctx = await setup()
    const instance = await createHttpInstance(ctx)
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/instances/${instance.id}/health`,
      cookies: ctx.member,
    })
    expect(res.statusCode).toBe(403)
  })
})
