import { describe, expect, it } from 'vitest'
import {
  createOrganization,
  createPluginInstance,
  createProject,
  createTestDb,
  type Db,
} from '@smokejumper/db'
import type { TelemetrySource } from '@smokejumper/plugin-sdk'
import { createFakeAlertSource, createFakeTelemetrySource } from '@smokejumper/plugin-sdk/testing'
import { createRegistry } from '../src/registry'
import { runInstanceHealthCheck } from '../src/health'

const encryptionKey = Buffer.alloc(32, 1).toString('base64')

async function setup(): Promise<{ db: Db; projectId: string }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  return { db, projectId: project.id }
}

function failingTelemetrySource(): TelemetrySource<{ prefix: string }> {
  const base = createFakeTelemetrySource()
  return {
    ...base,
    manifest: { ...base.manifest, id: 'boom' },
    async healthCheck() {
      throw new Error('cannot reach service')
    },
  }
}

describe('runInstanceHealthCheck', () => {
  it('returns the healthy result of a telemetry source', async () => {
    const { db, projectId } = await setup()
    const registry = createRegistry()
    registry.register(createFakeTelemetrySource())
    const instance = await createPluginInstance(db, {
      projectId,
      pluginId: 'fake-telemetry',
      kind: 'telemetry-source',
      name: 'Fake',
      config: { prefix: 'x' },
      credentials: {},
      encryptionKey,
    })
    expect(await runInstanceHealthCheck({ db, encryptionKey, registry, instanceId: instance.id })).toEqual({
      ok: true,
    })
  })

  it('reports { ok: false } with the error message when healthCheck throws', async () => {
    const { db, projectId } = await setup()
    const registry = createRegistry()
    registry.register(failingTelemetrySource())
    const instance = await createPluginInstance(db, {
      projectId,
      pluginId: 'boom',
      kind: 'telemetry-source',
      name: 'Boom',
      config: { prefix: 'x' },
      credentials: {},
      encryptionKey,
    })
    const health = await runInstanceHealthCheck({ db, encryptionKey, registry, instanceId: instance.id })
    expect(health.ok).toBe(false)
    expect(health.message).toContain('cannot reach service')
  })

  it('returns { ok: true } for an alert source with no outbound check', async () => {
    const { db, projectId } = await setup()
    const registry = createRegistry()
    registry.register(createFakeAlertSource())
    const instance = await createPluginInstance(db, {
      projectId,
      pluginId: 'fake-alerts',
      kind: 'alert-source',
      name: 'Fake alerts',
      config: {},
      credentials: { token: 't' },
      encryptionKey,
    })
    expect(await runInstanceHealthCheck({ db, encryptionKey, registry, instanceId: instance.id })).toEqual({
      ok: true,
    })
  })
})
