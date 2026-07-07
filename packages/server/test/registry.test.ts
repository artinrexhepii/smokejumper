import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addMember, createOrganization, createSession, createTestDb, createUser, listAudit, type Db } from '@smokejumper/db'
import { createBuiltinRegistry } from '@smokejumper/plugin-host'
import { createTestKeypair, signRegistryIndex, signVersion } from '@smokejumper/registry/testing'
import type { RegistryEntry, TrustKey } from '@smokejumper/registry'
import type { FastifyInstance } from 'fastify'
import { buildServer, createBus } from '../src/index.ts'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')
const INDEX_URL = 'https://example.test/registry/index.json'
const BUNDLE_URL = 'https://example.test/bundles/demo-plugin-1.0.0.json'

interface Ctx {
  db: Db
  app: FastifyInstance
  orgId: string
  pluginsDir: string
  owner: { sj_session: string }
  member: { sj_session: string }
}

const cleanupDirs: string[] = []
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function setup(opts: { fetchImpl?: typeof fetch; autoUpdate?: boolean; trustKeys?: TrustKey[] } = {}): Promise<Ctx> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const ownerUser = await createUser(db, { email: 'owner@example.com', password: 'smokejumper', name: 'Owner' })
  const memberUser = await createUser(db, { email: 'member@example.com', password: 'smokejumper', name: 'Member' })
  await addMember(db, { orgId: org.id, userId: ownerUser.id, role: 'owner' })
  await addMember(db, { orgId: org.id, userId: memberUser.id, role: 'member' })
  const pluginsDir = await mkdtemp(join(tmpdir(), 'sj-registry-route-'))
  cleanupDirs.push(pluginsDir)
  const app = await buildServer({
    db,
    encryptionKey: TEST_KEY,
    bus: createBus(),
    registry: createBuiltinRegistry(),
    registryClient: {
      db,
      pluginsDir,
      bundledIndexPath: join(pluginsDir, 'unused-index.json'),
      registryUrl: INDEX_URL,
      trustKeys: opts.trustKeys ?? [],
      autoUpdate: opts.autoUpdate ?? false,
      fetchImpl: opts.fetchImpl,
    },
  })
  return {
    db,
    app,
    orgId: org.id,
    pluginsDir,
    owner: { sj_session: (await createSession(db, ownerUser.id)).token },
    member: { sj_session: (await createSession(db, memberUser.id)).token },
  }
}

async function buildDemoIndex() {
  const key = createTestKeypair('index-signer')
  const manifest = {
    id: 'demo-plugin',
    name: 'Demo Plugin',
    version: '1.0.0',
    sdkVersion: '0.2.0',
    kind: 'telemetry-source' as const,
    description: 'demo',
  }
  const signed = await signVersion({ manifest, indexMjs: 'export default function create(){return{}}\n', privateKey: key.privateKey })
  const entry: RegistryEntry = {
    id: 'demo-plugin',
    name: 'Demo Plugin',
    kind: 'telemetry-source',
    description: 'demo',
    repo: 'https://example.test/demo-plugin',
    verified: true,
    signals: {},
    versions: [
      {
        version: '1.0.0',
        sdkVersion: '0.2.0',
        bundleUrl: BUNDLE_URL,
        digest: signed.digest,
        signature: signed.signature,
        signer: key.keyId,
      },
    ],
  }
  const index = signRegistryIndex({ entries: [entry], privateKey: key.privateKey, signer: key.keyId })
  return { index, signed, trustKey: key.trustKey }
}

function fetchImplFor(index: unknown, bundlePayload: unknown): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url === INDEX_URL) return new Response(JSON.stringify(index))
    if (url === BUNDLE_URL) return new Response(JSON.stringify(bundlePayload))
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

describe('registry routes', () => {
  it('returns the signed index and installed bundles for any authenticated user', async () => {
    const { index, signed, trustKey } = await buildDemoIndex()
    const ctx = await setup({ fetchImpl: fetchImplFor(index, signed.bundlePayload), trustKeys: [trustKey] })
    const res = await ctx.app.inject({ method: 'GET', url: '/api/registry', cookies: ctx.member })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.index.entries).toHaveLength(1)
    expect(body.installed).toEqual([])
  })

  it('returns the configured auto-update policy', async () => {
    const { index, signed, trustKey } = await buildDemoIndex()
    const ctx = await setup({ fetchImpl: fetchImplFor(index, signed.bundlePayload), autoUpdate: true, trustKeys: [trustKey] })
    const res = await ctx.app.inject({ method: 'GET', url: '/api/registry/policy', cookies: ctx.member })
    expect(res.json()).toEqual({ autoUpdate: true })
  })

  it('forbids members from installing a plugin', async () => {
    const { index, signed, trustKey } = await buildDemoIndex()
    const ctx = await setup({ fetchImpl: fetchImplFor(index, signed.bundlePayload), trustKeys: [trustKey] })
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/registry/install',
      cookies: ctx.member,
      payload: { id: 'demo-plugin', version: '1.0.0' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('404s an unknown plugin id on install', async () => {
    const { index, signed, trustKey } = await buildDemoIndex()
    const ctx = await setup({ fetchImpl: fetchImplFor(index, signed.bundlePayload), trustKeys: [trustKey] })
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/registry/install',
      cookies: ctx.owner,
      payload: { id: 'ghost-plugin', version: '1.0.0' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('installs a known plugin as an owner, audits it, and requires a restart', async () => {
    const { index, signed, trustKey } = await buildDemoIndex()
    const ctx = await setup({ fetchImpl: fetchImplFor(index, signed.bundlePayload), trustKeys: [trustKey] })
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/registry/install',
      cookies: ctx.owner,
      payload: { id: 'demo-plugin', version: '1.0.0' },
    })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ restartRequired: true })
    expect(await readdir(ctx.pluginsDir)).toContain('demo-plugin@1.0.0')
    const audit = await listAudit(ctx.db, { orgId: ctx.orgId })
    expect(audit[0]).toMatchObject({
      action: 'plugin.install',
      actorType: 'user',
      subjectType: 'registry_entry',
      subjectId: 'demo-plugin@1.0.0',
    })
  })

  it('rejects install when the fetched bundle is tampered in transit, writing nothing to disk', async () => {
    const { index, signed, trustKey } = await buildDemoIndex()
    const tamperedPayload = { ...signed.bundlePayload, indexMjs: 'export default function create(){return{evil:true}}\n' }
    const ctx = await setup({ fetchImpl: fetchImplFor(index, tamperedPayload), trustKeys: [trustKey] })
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/registry/install',
      cookies: ctx.owner,
      payload: { id: 'demo-plugin', version: '1.0.0' },
    })
    expect(res.statusCode).toBe(400)
    expect(await readdir(ctx.pluginsDir)).toEqual([])
  })
})
