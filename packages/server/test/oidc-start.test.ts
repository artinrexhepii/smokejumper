import { afterEach, describe, expect, it } from 'vitest'
import { createOrganization, createTestDb } from '@smokejumper/db'
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

async function enabledApp(): Promise<{ app: FastifyInstance; issuer: string }> {
  const db = await createTestDb()
  await createOrganization(db, { name: 'Acme', slug: 'acme' })
  idp = await startMockIdp('test-client')
  const oidc = await createOidcProvider({
    issuer: idp.issuer,
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'http://localhost:3400/api/auth/oidc/callback',
    scopes: 'openid email profile',
    defaultOrg: 'acme',
    defaultRole: 'member',
    buttonLabel: 'Sign in with SSO',
  })
  const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus(), oidc })
  return { app, issuer: idp.issuer }
}

describe('GET /api/auth/oidc/start', () => {
  it('redirects to the authorize endpoint and sets a signed sj_oidc cookie', async () => {
    const { app, issuer } = await enabledApp()
    const res = await app.inject({ method: 'GET', url: '/api/auth/oidc/start' })
    expect(res.statusCode).toBe(302)
    const location = res.headers.location as string
    expect(location.startsWith(`${issuer}/authorize`)).toBe(true)
    const params = new URL(location).searchParams
    expect(params.get('response_type')).toBe('code')
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('state')).toBeTruthy()
    expect(params.get('nonce')).toBeTruthy()

    const cookie = res.cookies.find((c) => c.name === 'sj_oidc')
    expect(cookie).toBeDefined()
    expect(cookie!.httpOnly).toBe(true)
    expect(cookie!.value.length).toBeGreaterThan(0)
  })

  it('returns 404 when oidc is disabled', async () => {
    const db = await createTestDb()
    const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus() })
    const res = await app.inject({ method: 'GET', url: '/api/auth/oidc/start' })
    expect(res.statusCode).toBe(404)
  })
})
