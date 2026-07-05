import { randomBytes } from 'node:crypto'
import {
  addMember,
  appendAudit,
  createSession,
  createUser,
  getOrganizationBySlug,
  getUserByEmail,
  listOrganizationsForUser,
} from '@smokejumper/db'
import type { FastifyInstance } from 'fastify'
import { SESSION_COOKIE, type ServerDeps } from '../server.ts'

const OIDC_COOKIE = 'sj_oidc'
const OIDC_COOKIE_MAX_AGE = 300

function secureCookies(): boolean {
  return process.env.SMOKEJUMPER_SECURE_COOKIES === '1'
}

function dashboardUrl(): string {
  return process.env.DASHBOARD_URL ?? process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000'
}

export function registerAuthRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/auth/config', async () => ({
    password: true,
    oidc: {
      enabled: Boolean(deps.oidc),
      buttonLabel: deps.oidc?.buttonLabel ?? 'Sign in with SSO',
    },
  }))

  app.get('/api/auth/oidc/start', async (request, reply) => {
    if (!deps.oidc) return reply.code(404).send({ error: 'oidc disabled' })
    const { authorizationUrl, state, codeVerifier, nonce } = await deps.oidc.start()
    reply.setCookie(OIDC_COOKIE, JSON.stringify({ state, codeVerifier, nonce }), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      signed: true,
      maxAge: OIDC_COOKIE_MAX_AGE,
      secure: secureCookies(),
    })
    return reply.redirect(authorizationUrl)
  })

  app.get('/api/auth/oidc/callback', async (request, reply) => {
    const oidc = deps.oidc
    if (!oidc) return reply.code(404).send({ error: 'oidc disabled' })

    const raw = request.cookies[OIDC_COOKIE]
    if (!raw) return reply.code(400).send({ error: 'missing oidc state' })
    const unsigned = request.unsignCookie(raw)
    if (!unsigned.valid || !unsigned.value) {
      return reply.code(400).send({ error: 'invalid oidc state' })
    }
    let stored: { state: string; codeVerifier: string; nonce: string }
    try {
      stored = JSON.parse(unsigned.value)
    } catch {
      return reply.code(400).send({ error: 'invalid oidc state' })
    }

    const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3400'
    const currentUrl = new URL(request.url, publicBaseUrl)
    let profile: { email: string; name: string }
    try {
      profile = await oidc.callback(currentUrl, stored)
    } catch (err) {
      request.log.warn({ err }, 'oidc callback verification failed')
      return reply.code(400).send({ error: 'oidc verification failed' })
    }

    const existing = await getUserByEmail(deps.db, profile.email)
    const account =
      existing ??
      (await createUser(deps.db, {
        email: profile.email,
        name: profile.name,
        password: randomBytes(32).toString('base64'),
      }))

    const org = await getOrganizationBySlug(deps.db, oidc.defaultOrg)
    if (!org) {
      return reply
        .code(500)
        .send({ error: `oidc default org "${oidc.defaultOrg}" does not exist` })
    }

    const memberships = await listOrganizationsForUser(deps.db, account.id)
    if (!memberships.some((o) => o.id === org.id)) {
      await addMember(deps.db, { orgId: org.id, userId: account.id, role: oidc.defaultRole })
    }

    if (!existing) {
      await appendAudit(deps.db, {
        orgId: org.id,
        actorType: 'user',
        actorId: account.id,
        action: 'user.oidc.provisioned',
        subjectType: 'user',
        subjectId: account.id,
        detail: { email: account.email },
      })
    }
    await appendAudit(deps.db, {
      orgId: org.id,
      actorType: 'user',
      actorId: account.id,
      action: 'user.oidc.login',
      subjectType: 'user',
      subjectId: account.id,
      detail: { email: account.email },
    })

    const { token, expiresAt } = await createSession(deps.db, account.id)
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
      secure: secureCookies(),
    })
    reply.clearCookie(OIDC_COOKIE, { path: '/', secure: secureCookies() })
    return reply.redirect(dashboardUrl())
  })
}
