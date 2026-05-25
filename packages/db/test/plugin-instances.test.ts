import { describe, expect, it } from 'vitest'
import {
  createOrganization,
  createPluginInstance,
  createProject,
  createTestDb,
  getDecryptedConfig,
  getPluginInstance,
  listPluginInstances,
  type Db,
} from '../src/index.ts'

const KEY = Buffer.alloc(32, 7).toString('base64')

async function setup(): Promise<{ db: Db; projectId: string }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  return { db, projectId: project.id }
}

describe('plugin instances', () => {
  it('encrypts credentials at rest and merges them on decryption', async () => {
    const { db, projectId } = await setup()
    const instance = await createPluginInstance(db, {
      projectId,
      pluginId: 'slack',
      kind: 'notification-sink',
      name: 'Team Slack',
      config: { channel: '#incidents' },
      credentials: { botToken: 'xoxb-secret' },
      encryptionKey: KEY,
    })
    expect(instance.enabled).toBe(true)
    expect(instance.credentialsEncrypted).toMatch(/^v1:/)
    expect(instance.credentialsEncrypted).not.toContain('xoxb-secret')
    expect(getDecryptedConfig(instance, KEY)).toEqual({
      channel: '#incidents',
      botToken: 'xoxb-secret',
    })
  })

  it('stores null credentials when none are provided', async () => {
    const { db, projectId } = await setup()
    const instance = await createPluginInstance(db, {
      projectId,
      pluginId: 'http',
      kind: 'telemetry-source',
      name: 'HTTP checks',
      config: {},
      credentials: {},
      encryptionKey: KEY,
    })
    expect(instance.credentialsEncrypted).toBeNull()
    expect(getDecryptedConfig(instance, KEY)).toEqual({})
  })

  it('fetches instances by id', async () => {
    const { db, projectId } = await setup()
    const created = await createPluginInstance(db, {
      projectId,
      pluginId: 'webhook',
      kind: 'alert-source',
      name: 'Generic webhook',
      config: {},
      credentials: { token: 'demo-token' },
      encryptionKey: KEY,
    })
    expect((await getPluginInstance(db, created.id))?.pluginId).toBe('webhook')
    expect(await getPluginInstance(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined()
  })

  it('lists instances filtered by kind', async () => {
    const { db, projectId } = await setup()
    await createPluginInstance(db, {
      projectId,
      pluginId: 'webhook',
      kind: 'alert-source',
      name: 'Webhook',
      config: {},
      credentials: {},
      encryptionKey: KEY,
    })
    await createPluginInstance(db, {
      projectId,
      pluginId: 'docker',
      kind: 'telemetry-source',
      name: 'Docker',
      config: { host: 'http://docker-proxy:2375' },
      credentials: {},
      encryptionKey: KEY,
    })
    expect(await listPluginInstances(db, projectId)).toHaveLength(2)
    const telemetry = await listPluginInstances(db, projectId, 'telemetry-source')
    expect(telemetry.map((i) => i.pluginId)).toEqual(['docker'])
  })
})
