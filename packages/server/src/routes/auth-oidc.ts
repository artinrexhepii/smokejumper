import type { FastifyInstance } from 'fastify'
import type { ServerDeps } from '../server.ts'

const OIDC_COOKIE = 'sj_oidc'
const OIDC_COOKIE_MAX_AGE = 300

function secureCookies(): boolean {
  return process.env.SMOKEJUMPER_SECURE_COOKIES === '1'
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
}
