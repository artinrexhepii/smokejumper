import { afterEach, describe, expect, it } from 'vitest'
import { createOrganization, createTestDb, type Db } from '@smokejumper/db'
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

async function baseDb(): Promise<Db> {
  const db = await createTestDb()
  await createOrganization(db, { name: 'Acme', slug: 'acme' })
  return db
}

async function disabledApp(): Promise<FastifyInstance> {
  const db = await baseDb()
  return buildServer({ db, encryptionKey: TEST_KEY, bus: createBus() })
}

async function enabledApp(): Promise<FastifyInstance> {
  const db = await baseDb()
  idp = await startMockIdp('test-client')
  const oidc = await createOidcProvider({
    issuer: idp.issuer,
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'http://localhost:3400/api/auth/oidc/callback',
    scopes: 'openid email profile',
    defaultOrg: 'acme',
    defaultRole: 'member',
    buttonLabel: 'Corp SSO',
  })
  return buildServer({ db, encryptionKey: TEST_KEY, bus: createBus(), oidc })
}

describe('GET /api/auth/config', () => {
  it('reports oidc disabled without a session', async () => {
    const app = await disabledApp()
    const res = await app.inject({ method: 'GET', url: '/api/auth/config' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      password: true,
      oidc: { enabled: false, buttonLabel: 'Sign in with SSO' },
      needsSetup: true,
      allowSignup: false,
    })
  })

  it('advertises the button label when oidc is enabled', async () => {
    const app = await enabledApp()
    const res = await app.inject({ method: 'GET', url: '/api/auth/config' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      password: true,
      oidc: { enabled: true, buttonLabel: 'Corp SSO' },
      needsSetup: true,
      allowSignup: false,
    })
  })
})
