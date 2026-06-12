import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import {
  createSession,
  deleteSession,
  getSession,
  listOrganizationsForUser,
  verifyCredentials,
  type Db,
  type User,
} from '@smokejumper/db'
import Fastify, { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { IncidentBus } from './bus.ts'
import { registerDataRoutes } from './routes.ts'

export interface ServerDeps {
  db: Db
  encryptionKey: string
  bus: IncidentBus
  registry?: unknown
  investigator?: unknown
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: { user: User; orgIds: string[] } | null
  }
}

export const SESSION_COOKIE = 'sj_session'

const loginBody = z.object({ email: z.string(), password: z.string() })

function toPublicUser(user: User): { id: string; email: string; name: string } {
  return { id: user.id, email: user.email, name: user.name }
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ forceCloseConnections: true })
  await app.register(cookie)
  await app.register(cors, {
    origin: process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  })

  app.decorateRequest('auth', null)

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? ''
    if (!path.startsWith('/api/') || path === '/api/auth/login') return
    const token = request.cookies[SESSION_COOKIE]
    const session = token ? await getSession(deps.db, token) : null
    if (!session) return reply.code(401).send({ error: 'unauthorized' })
    request.auth = session
  })

  app.get('/healthz', async () => ({ ok: true }))

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })
    const user = await verifyCredentials(deps.db, parsed.data)
    if (!user) return reply.code(401).send({ error: 'invalid credentials' })
    const { token, expiresAt } = await createSession(deps.db, user.id)
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    })
    return { user: toPublicUser(user) }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) await deleteSession(deps.db, token)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.code(204).send()
  })

  app.get('/api/me', async (request) => {
    const auth = request.auth!
    const orgs = await listOrganizationsForUser(deps.db, auth.user.id)
    return { user: toPublicUser(auth.user), orgs }
  })

  registerDataRoutes(app, deps)

  return app
}
