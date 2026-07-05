import { describe, expect, it } from 'vitest'
import {
  addMember,
  createOrganization,
  createSession,
  createTestDb,
  createUser,
  type Organization,
} from '@smokejumper/db'
import { createBuiltinRegistry } from '@smokejumper/plugin-host'
import type { FastifyInstance } from 'fastify'
import { buildServer, createBus } from '../src/index.ts'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

async function setup(): Promise<{ app: FastifyInstance; org: Organization; cookies: { sj_session: string } }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const user = await createUser(db, { email: 'owner@example.com', password: 'smokejumper', name: 'Owner' })
  await addMember(db, { orgId: org.id, userId: user.id, role: 'owner' })
  const { token } = await createSession(db, user.id)
  const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus(), registry: createBuiltinRegistry() })
  return { app, org, cookies: { sj_session: token } }
}

describe('GET /api/plugins', () => {
  it('returns public manifests and descriptors for all first-party plugins', async () => {
    const { app, cookies } = await setup()
    const res = await app.inject({ method: 'GET', url: '/api/plugins', cookies })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Array<{
      manifest: Record<string, unknown>
      descriptor: { config: unknown[]; credentials: Array<{ key: string; type: string; required: boolean; secret: boolean }> }
    }>
    const webhook = body.find((p) => p.manifest.id === 'webhook')!
    expect(webhook.manifest.sdkVersion).toBe('0.2.0')
    expect(Object.keys(webhook.manifest)).toEqual(['id', 'name', 'version', 'kind', 'description', 'sdkVersion'])
    expect(webhook.descriptor.config).toEqual([])
    expect(webhook.descriptor.credentials).toEqual([
      { key: 'token', type: 'string', required: true, secret: true },
    ])
  })

  it('requires a session', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/api/plugins' })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/me role', () => {
  it('includes the caller role for each org', async () => {
    const { app, org, cookies } = await setup()
    const res = await app.inject({ method: 'GET', url: '/api/me', cookies })
    expect(res.statusCode).toBe(200)
    const found = res.json().orgs.find((o: { id: string }) => o.id === org.id)
    expect(found.role).toBe('owner')
  })
})
