import type { FastifyInstance } from 'fastify'
import type { ServerDeps } from '../server.ts'

export function registerAuthRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/auth/config', async () => ({
    password: true,
    oidc: {
      enabled: Boolean(deps.oidc),
      buttonLabel: deps.oidc?.buttonLabel ?? 'Sign in with SSO',
    },
  }))
}
