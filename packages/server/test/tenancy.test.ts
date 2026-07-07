import { describe, expect, it } from 'vitest'
import {
  addMember,
  createOrganization,
  createSession,
  createTestDb,
  createUser,
  listMembers,
  type Db,
} from '@smokejumper/db'
import type { FastifyInstance } from 'fastify'
import { createBus } from '../src/bus.ts'
import { buildServer } from '../src/server.ts'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

async function freshServer(): Promise<{ db: Db; app: FastifyInstance }> {
  const db = await createTestDb()
  const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus() })
  return { db, app }
}

interface OwnerCtx {
  db: Db
  app: FastifyInstance
  orgId: string
  ownerId: string
  cookies: { sj_session: string }
}

async function withOwner(): Promise<OwnerCtx> {
  const { db, app } = await freshServer()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const owner = await createUser(db, { email: 'owner@acme.com', password: 'supersecret', name: 'Owner' })
  await addMember(db, { orgId: org.id, userId: owner.id, role: 'owner' })
  const { token } = await createSession(db, owner.id)
  return { db, app, orgId: org.id, ownerId: owner.id, cookies: { sj_session: token } }
}

function sessionCookie(res: { cookies: Array<{ name: string; value: string }> }): { sj_session: string } {
  const c = res.cookies.find((x) => x.name === 'sj_session')
  if (!c) throw new Error('no session cookie set')
  return { sj_session: c.value }
}

describe('first-run setup', () => {
  it('reports needsSetup and bootstraps the first owner', async () => {
    const { app } = await freshServer()
    expect((await app.inject({ method: 'GET', url: '/api/auth/config' })).json().needsSetup).toBe(true)

    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { email: 'owner@acme.com', password: 'supersecret', name: 'Owner', orgName: 'Acme' },
    })
    expect(setup.statusCode).toBe(201)
    const cookies = sessionCookie(setup)

    expect((await app.inject({ method: 'GET', url: '/api/auth/config' })).json().needsSetup).toBe(false)

    const me = await app.inject({ method: 'GET', url: '/api/me', cookies })
    expect(me.statusCode).toBe(200)
    expect(me.json().orgs[0]).toMatchObject({ name: 'Acme', role: 'owner' })

    const again = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { email: 'x@y.com', password: 'supersecret', name: 'X', orgName: 'Y' },
    })
    expect(again.statusCode).toBe(409)
  })

  it('rejects a short password', async () => {
    const { app } = await freshServer()
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { email: 'o@a.com', password: 'short', name: 'O', orgName: 'A' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('invites', () => {
  it('mints an invite, previews it, accepts it, and blocks reuse', async () => {
    const { app, orgId, cookies } = await withOwner()
    const created = await app.inject({
      method: 'POST',
      url: `/api/orgs/${orgId}/invites`,
      cookies,
      payload: { role: 'member' },
    })
    expect(created.statusCode).toBe(201)
    const { token, url } = created.json()
    expect(url).toContain(`/join/${token}`)

    const preview = await app.inject({ method: 'GET', url: `/api/invites/${token}` })
    expect(preview.json()).toMatchObject({ valid: true, orgName: 'Acme', role: 'member' })

    const accept = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      payload: { name: 'Joiner', email: 'joiner@acme.com', password: 'supersecret' },
    })
    expect(accept.statusCode).toBe(201)

    const members = await app.inject({ method: 'GET', url: `/api/orgs/${orgId}/members`, cookies })
    expect(members.json().map((m: { email: string }) => m.email)).toContain('joiner@acme.com')

    const reuse = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      payload: { name: 'X', email: 'x@acme.com', password: 'supersecret' },
    })
    expect(reuse.statusCode).toBe(410)

    expect((await app.inject({ method: 'GET', url: `/api/orgs/${orgId}/invites`, cookies })).json()).toEqual([])
  })

  it('forbids non-managers from inviting, and revokes invites', async () => {
    const { db, app, orgId, cookies } = await withOwner()
    const member = await createUser(db, { email: 'm@acme.com', password: 'supersecret', name: 'M' })
    await addMember(db, { orgId, userId: member.id, role: 'member' })
    const { token: mtoken } = await createSession(db, member.id)
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/orgs/${orgId}/invites`,
      cookies: { sj_session: mtoken },
      payload: { role: 'member' },
    })
    expect(forbidden.statusCode).toBe(403)

    const created = await app.inject({
      method: 'POST',
      url: `/api/orgs/${orgId}/invites`,
      cookies,
      payload: { role: 'admin' },
    })
    const { id } = created.json()
    const del = await app.inject({ method: 'DELETE', url: `/api/orgs/${orgId}/invites/${id}`, cookies })
    expect(del.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/api/orgs/${orgId}/invites`, cookies })).json()).toEqual([])
  })
})

describe('members and org', () => {
  it('changes roles, guards the last owner, removes members, and renames the org', async () => {
    const { db, app, orgId, cookies, ownerId } = await withOwner()
    const member = await createUser(db, { email: 'm@acme.com', password: 'supersecret', name: 'M' })
    await addMember(db, { orgId, userId: member.id, role: 'member' })

    const promote = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${orgId}/members/${member.id}`,
      cookies,
      payload: { role: 'admin' },
    })
    expect(promote.statusCode).toBe(204)
    expect((await listMembers(db, orgId)).find((m) => m.userId === member.id)?.role).toBe('admin')

    const demoteOwner = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${orgId}/members/${ownerId}`,
      cookies,
      payload: { role: 'member' },
    })
    expect(demoteOwner.statusCode).toBe(409)

    const removeOwner = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${orgId}/members/${ownerId}`,
      cookies,
    })
    expect(removeOwner.statusCode).toBe(409)

    const removeMemberRes = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${orgId}/members/${member.id}`,
      cookies,
    })
    expect(removeMemberRes.statusCode).toBe(204)
    expect((await listMembers(db, orgId)).map((m) => m.userId)).toEqual([ownerId])

    const rename = await app.inject({ method: 'PATCH', url: `/api/orgs/${orgId}`, cookies, payload: { name: 'Acme Inc' } })
    expect(rename.statusCode).toBe(200)
    expect(rename.json().name).toBe('Acme Inc')
  })
})

describe('open signup flag', () => {
  it('is disabled by default, enables via env, and enforces the domain allowlist', async () => {
    const { db, app, orgId } = await withOwner()
    delete process.env.SMOKEJUMPER_ALLOW_SIGNUP
    const off = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 's@acme.com', password: 'supersecret', name: 'S' },
    })
    expect(off.statusCode).toBe(404)

    process.env.SMOKEJUMPER_ALLOW_SIGNUP = '1'
    try {
      const on = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: 's@acme.com', password: 'supersecret', name: 'S' },
      })
      expect(on.statusCode).toBe(201)
      expect((await listMembers(db, orgId)).find((m) => m.email === 's@acme.com')?.role).toBe('member')

      process.env.SMOKEJUMPER_SIGNUP_ALLOWED_DOMAINS = 'allowed.com'
      const blocked = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: 'x@other.com', password: 'supersecret', name: 'X' },
      })
      expect(blocked.statusCode).toBe(403)
    } finally {
      delete process.env.SMOKEJUMPER_ALLOW_SIGNUP
      delete process.env.SMOKEJUMPER_SIGNUP_ALLOWED_DOMAINS
    }
  })
})
