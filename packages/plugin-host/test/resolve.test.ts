import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createOrganization,
  createPluginInstance,
  createProject,
  createTestDb,
} from '@smokejumper/db'
import { createFakeAlertSource } from '@smokejumper/plugin-sdk/testing'
import { InstanceNotFoundError, PluginConfigError, UnknownPluginError } from '../src/errors'
import { createRegistry } from '../src/registry'
import { resolveInstance } from '../src/resolve'

const encryptionKey = Buffer.alloc(32, 1).toString('base64')

async function setup() {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  return { db, project }
}

describe('resolveInstance', () => {
  it('merges decrypted credentials into config and validates against the manifest schema', async () => {
    const { db, project } = await setup()
    const registry = createRegistry()
    registry.register(createFakeAlertSource())
    const created = await createPluginInstance(db, {
      projectId: project.id,
      pluginId: 'fake-alerts',
      kind: 'alert-source',
      name: 'Fake alerts',
      config: {},
      credentials: { token: 'secret' },
      encryptionKey,
    })
    const { instance, config } = await resolveInstance({ db, encryptionKey, registry, instanceId: created.id })
    expect(instance.id).toBe(created.id)
    expect(config).toEqual({ token: 'secret' })
  })

  it('throws InstanceNotFoundError for a missing instance', async () => {
    const { db } = await setup()
    const registry = createRegistry()
    await expect(
      resolveInstance({ db, encryptionKey, registry, instanceId: randomUUID() }),
    ).rejects.toBeInstanceOf(InstanceNotFoundError)
  })

  it('throws UnknownPluginError when no registered plugin matches', async () => {
    const { db, project } = await setup()
    const registry = createRegistry()
    const created = await createPluginInstance(db, {
      projectId: project.id,
      pluginId: 'ghost',
      kind: 'alert-source',
      name: 'Ghost',
      config: {},
      credentials: {},
      encryptionKey,
    })
    await expect(
      resolveInstance({ db, encryptionKey, registry, instanceId: created.id }),
    ).rejects.toBeInstanceOf(UnknownPluginError)
  })

  it('throws PluginConfigError when the merged config fails the manifest schema', async () => {
    const { db, project } = await setup()
    const registry = createRegistry()
    registry.register(createFakeAlertSource())
    const created = await createPluginInstance(db, {
      projectId: project.id,
      pluginId: 'fake-alerts',
      kind: 'alert-source',
      name: 'Misconfigured',
      config: {},
      credentials: {},
      encryptionKey,
    })
    const attempt = resolveInstance({ db, encryptionKey, registry, instanceId: created.id })
    await expect(attempt).rejects.toBeInstanceOf(PluginConfigError)
    await expect(attempt).rejects.toThrow(/token/)
  })
})
