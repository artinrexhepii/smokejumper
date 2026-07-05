import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  addMember,
  createOrganization,
  createProject,
  createSession,
  createTestDb,
  createUser,
  listAudit,
  type Db,
} from '@smokejumper/db'
import { createBuiltinRegistry } from '@smokejumper/plugin-host'
import type { FastifyInstance } from 'fastify'
import { buildServer, createBus } from '../src/index.ts'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

interface Ctx {
  db: Db
  app: FastifyInstance
  orgId: string
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
    orgId: org.id,
    projectId: project.id,
    owner: { sj_session: (await createSession(db, ownerUser.id)).token },
    member: { sj_session: (await createSession(db, memberUser.id)).token },
  }
}

describe('plugin instance CRUD', () => {
  it('creates a slack instance, hides the secret, and audits the creation', async () => {
    const ctx = await setup()
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${ctx.projectId}/instances`,
      cookies: ctx.owner,
      payload: {
        pluginId: 'slack',
        name: 'Team Slack',
        config: { channel: '#incidents' },
        credentials: { botToken: 'xoxb-secret' },
      },
    })
    expect(res.statusCode).toBe(201)
    const view = res.json()
    expect(view.config).toEqual({ channel: '#incidents' })
    expect(view.credentials).toEqual({ botToken: 'set' })
    expect(JSON.stringify(view)).not.toContain('xoxb-secret')
    const audit = await listAudit(ctx.db, { orgId: ctx.orgId })
    expect(audit[0]).toMatchObject({
      action: 'plugin.instance.created',
      actorType: 'user',
      subjectType: 'plugin_instance',
      subjectId: view.id,
    })
  })

  it('exposes an ingestUrl for alert-source instances only', async () => {
    const ctx = await setup()
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${ctx.projectId}/instances`,
      cookies: ctx.owner,
      payload: { pluginId: 'webhook', name: 'Hook', config: {}, credentials: { token: 't' } },
    })
    expect(res.statusCode).toBe(201)
    const view = res.json()
    expect(view.ingestUrl).toBe(`http://localhost:3400/ingest/${view.id}`)
  })

  it('rejects an unknown pluginId and invalid config with 400', async () => {
    const ctx = await setup()
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${ctx.projectId}/instances`,
      cookies: ctx.owner,
      payload: { pluginId: 'ghost', name: 'X', config: {}, credentials: {} },
    })
    expect(unknown.statusCode).toBe(400)
    const bad = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${ctx.projectId}/instances`,
      cookies: ctx.owner,
      payload: { pluginId: 'slack', name: 'X', config: {}, credentials: {} },
    })
    expect(bad.statusCode).toBe(400)
  })

  it('forbids plain members from creating instances', async () => {
    const ctx = await setup()
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${ctx.projectId}/instances`,
      cookies: ctx.member,
      payload: { pluginId: 'http', name: 'HTTP', config: {}, credentials: {} },
    })
    expect(res.statusCode).toBe(403)
  })

  it('forbids plain members from reading/updating/deleting instances', async () => {
    const ctx = await setup()
    const created = (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/projects/${ctx.projectId}/instances`,
        cookies: ctx.owner,
        payload: {
          pluginId: 'slack',
          name: 'Team',
          config: { channel: '#a' },
          credentials: { botToken: 'xoxb-1' },
        },
      })
    ).json()

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${ctx.projectId}/instances`,
      cookies: ctx.member,
    })
    expect(list.statusCode).toBe(403)

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/instances/${created.id}`,
      cookies: ctx.member,
    })
    expect(get.statusCode).toBe(403)

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/instances/${created.id}`,
      cookies: ctx.member,
      payload: { name: 'Renamed', config: { channel: '#b' }, enabled: false },
    })
    expect(patch.statusCode).toBe(403)

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/instances/${created.id}`,
      cookies: ctx.member,
    })
    expect(del.statusCode).toBe(403)
  })

  it('lists, updates, and deletes an instance', async () => {
    const ctx = await setup()
    const created = (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/projects/${ctx.projectId}/instances`,
        cookies: ctx.owner,
        payload: {
          pluginId: 'slack',
          name: 'Team',
          config: { channel: '#a' },
          credentials: { botToken: 'xoxb-1' },
        },
      })
    ).json()

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${ctx.projectId}/instances`,
      cookies: ctx.owner,
    })
    expect(list.json().map((i: { id: string }) => i.id)).toEqual([created.id])

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/instances/${created.id}`,
      cookies: ctx.owner,
      payload: { name: 'Renamed', config: { channel: '#b' }, enabled: false },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json()).toMatchObject({ name: 'Renamed', enabled: false, config: { channel: '#b' } })
    expect(patched.json().credentials).toEqual({ botToken: 'set' })

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/instances/${created.id}`,
      cookies: ctx.owner,
    })
    expect(del.statusCode).toBe(204)
    const after = await ctx.app.inject({
      method: 'GET',
      url: `/api/instances/${created.id}`,
      cookies: ctx.owner,
    })
    expect(after.statusCode).toBe(404)
  })

  it('404s unknown instances and projects', async () => {
    const ctx = await setup()
    expect(
      (await ctx.app.inject({ method: 'GET', url: `/api/instances/${randomUUID()}`, cookies: ctx.owner }))
        .statusCode,
    ).toBe(404)
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/projects/${randomUUID()}/instances`,
          cookies: ctx.owner,
        })
      ).statusCode,
    ).toBe(404)
  })
})
