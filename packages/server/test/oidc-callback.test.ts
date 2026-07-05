import { afterEach, describe, expect, it } from 'vitest'
import {
  createOrganization,
  createTestDb,
  getSession,
  getUserByEmail,
  listAudit,
  listOrganizationsForUser,
  type Db,
} from '@smokejumper/db'
import type { FastifyInstance } from 'fastify'
import { createBus } from '../src/bus.ts'
import { buildServer } from '../src/server.ts'
import { createOidcProvider } from '../src/oidc.ts'
import { startMockIdp, type MockIdp } from './helpers/mock-idp.ts'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

let idp: MockIdp | undefined

afterEach(async () => {
  await idp?.close()
  idp = undefined
})

interface Ctx {
  db: Db
  app: FastifyInstance
  orgId: string
}

async function setup(defaultOrg = 'acme'): Promise<Ctx> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  idp = await startMockIdp('test-client')
  const oidc = await createOidcProvider({
    issuer: idp.issuer,
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'http://localhost:3400/api/auth/oidc/callback',
    scopes: 'openid email profile',
    defaultOrg,
    defaultRole: 'member',
    buttonLabel: 'Sign in with SSO',
  })
  const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus(), oidc })
  return { db, app, orgId: org.id }
}

// Runs /start, follows the mock authorize redirect, and returns the callback path + the sj_oidc cookie.
async function beginLogin(app: FastifyInstance): Promise<{ callbackPath: string; oidcCookie: string }> {
  const start = await app.inject({ method: 'GET', url: '/api/auth/oidc/start' })
  const oidcCookie = start.cookies.find((c) => c.name === 'sj_oidc')!.value
  const authRes = await fetch(start.headers.location as string, { redirect: 'manual' })
  const redirected = new URL(authRes.headers.get('location')!)
  return { callbackPath: `${redirected.pathname}${redirected.search}`, oidcCookie }
}

describe('GET /api/auth/oidc/callback', () => {
  it('provisions a new user, adds membership, audits, and issues a session', async () => {
    const ctx = await setup()
    idp!.setUser({ sub: 'user-1', email: 'alice@example.com', name: 'Alice Example' })
    const { callbackPath, oidcCookie } = await beginLogin(ctx.app)

    const res = await ctx.app.inject({
      method: 'GET',
      url: callbackPath,
      cookies: { sj_oidc: oidcCookie },
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('http://localhost:3000')

    const session = res.cookies.find((c) => c.name === 'sj_session')
    expect(session).toBeDefined()
    expect(session!.httpOnly).toBe(true)
    expect((await getSession(ctx.db, session!.value))?.user.email).toBe('alice@example.com')

    const user = await getUserByEmail(ctx.db, 'alice@example.com')
    expect(user).toBeDefined()
    expect((await listOrganizationsForUser(ctx.db, user!.id)).map((o) => o.id)).toEqual([ctx.orgId])

    const audit = await listAudit(ctx.db, { orgId: ctx.orgId })
    const actions = audit.map((a) => a.action)
    expect(actions).toContain('user.oidc.provisioned')
    expect(actions).toContain('user.oidc.login')
  })

  it('does not re-provision or duplicate membership on a second login', async () => {
    const ctx = await setup()
    idp!.setUser({ sub: 'user-1', email: 'alice@example.com', name: 'Alice Example' })

    const first = await beginLogin(ctx.app)
    await ctx.app.inject({ method: 'GET', url: first.callbackPath, cookies: { sj_oidc: first.oidcCookie } })

    const second = await beginLogin(ctx.app)
    const res = await ctx.app.inject({
      method: 'GET',
      url: second.callbackPath,
      cookies: { sj_oidc: second.oidcCookie },
    })
    expect(res.statusCode).toBe(302)

    const user = await getUserByEmail(ctx.db, 'alice@example.com')
    expect((await listOrganizationsForUser(ctx.db, user!.id)).map((o) => o.id)).toEqual([ctx.orgId])
    const audit = await listAudit(ctx.db, { orgId: ctx.orgId })
    expect(audit.filter((a) => a.action === 'user.oidc.provisioned')).toHaveLength(1)
    expect(audit.filter((a) => a.action === 'user.oidc.login')).toHaveLength(2)
  })

  it('400s when the sj_oidc cookie is missing', async () => {
    const ctx = await setup()
    idp!.setUser({ sub: 'user-1', email: 'alice@example.com', name: 'Alice' })
    const { callbackPath } = await beginLogin(ctx.app)
    const res = await ctx.app.inject({ method: 'GET', url: callbackPath })
    expect(res.statusCode).toBe(400)
  })

  it('400s when the state does not match the cookie', async () => {
    const ctx = await setup()
    idp!.setUser({ sub: 'user-1', email: 'alice@example.com', name: 'Alice' })
    const { callbackPath, oidcCookie } = await beginLogin(ctx.app)
    const tampered = new URL(callbackPath, 'http://localhost:3400')
    tampered.searchParams.set('state', 'forged-state')
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${tampered.pathname}${tampered.search}`,
      cookies: { sj_oidc: oidcCookie },
    })
    expect(res.statusCode).toBe(400)
  })

  it('400s when the id_token has no email claim', async () => {
    const ctx = await setup()
    idp!.setUser({ sub: 'user-1' })
    const { callbackPath, oidcCookie } = await beginLogin(ctx.app)
    const res = await ctx.app.inject({
      method: 'GET',
      url: callbackPath,
      cookies: { sj_oidc: oidcCookie },
    })
    expect(res.statusCode).toBe(400)
    expect(await getUserByEmail(ctx.db, 'alice@example.com')).toBeUndefined()
  })

  it('500s when the configured default org does not exist', async () => {
    const ctx = await setup('ghost-org')
    idp!.setUser({ sub: 'user-1', email: 'alice@example.com', name: 'Alice' })
    const { callbackPath, oidcCookie } = await beginLogin(ctx.app)
    const res = await ctx.app.inject({
      method: 'GET',
      url: callbackPath,
      cookies: { sj_oidc: oidcCookie },
    })
    expect(res.statusCode).toBe(500)
  })

  it('404s when oidc is disabled', async () => {
    const db = await createTestDb()
    const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus() })
    const res = await app.inject({ method: 'GET', url: '/api/auth/oidc/callback?code=x&state=y' })
    expect(res.statusCode).toBe(404)
  })
})
