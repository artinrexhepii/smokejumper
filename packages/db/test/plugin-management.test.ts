import { describe, expect, it } from 'vitest'
import {
  addMember,
  createOrganization,
  createPluginInstance,
  createProject,
  createTestDb,
  createUser,
  deletePluginInstance,
  getDecryptedConfig,
  getMemberRole,
  getPluginInstance,
  updatePluginInstance,
  type Db,
} from '../src/index.ts'

const KEY = Buffer.alloc(32, 7).toString('base64')

async function setup(): Promise<{ db: Db; projectId: string }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  return { db, projectId: project.id }
}

describe('updatePluginInstance', () => {
  it('replaces config and re-encrypts credentials when provided', async () => {
    const { db, projectId } = await setup()
    const created = await createPluginInstance(db, {
      projectId,
      pluginId: 'slack',
      kind: 'notification-sink',
      name: 'Team',
      config: { channel: '#a' },
      credentials: { botToken: 'xoxb-1' },
      encryptionKey: KEY,
    })
    const updated = await updatePluginInstance(db, created.id, {
      name: 'Team 2',
      config: { channel: '#b' },
      credentials: { botToken: 'xoxb-2' },
      encryptionKey: KEY,
    })
    expect(updated.name).toBe('Team 2')
    expect(getDecryptedConfig(updated, KEY)).toEqual({ channel: '#b', botToken: 'xoxb-2' })
  })

  it('leaves stored credentials intact when credentials are omitted', async () => {
    const { db, projectId } = await setup()
    const created = await createPluginInstance(db, {
      projectId,
      pluginId: 'slack',
      kind: 'notification-sink',
      name: 'Team',
      config: { channel: '#a' },
      credentials: { botToken: 'xoxb-1' },
      encryptionKey: KEY,
    })
    const updated = await updatePluginInstance(db, created.id, { enabled: false, encryptionKey: KEY })
    expect(updated.enabled).toBe(false)
    expect(getDecryptedConfig(updated, KEY)).toEqual({ channel: '#a', botToken: 'xoxb-1' })
  })

  it('clears credentials when an empty object is provided', async () => {
    const { db, projectId } = await setup()
    const created = await createPluginInstance(db, {
      projectId,
      pluginId: 'slack',
      kind: 'notification-sink',
      name: 'Team',
      config: {},
      credentials: { botToken: 'xoxb-1' },
      encryptionKey: KEY,
    })
    const updated = await updatePluginInstance(db, created.id, { credentials: {}, encryptionKey: KEY })
    expect(updated.credentialsEncrypted).toBeNull()
  })
})

describe('deletePluginInstance', () => {
  it('removes the instance', async () => {
    const { db, projectId } = await setup()
    const created = await createPluginInstance(db, {
      projectId,
      pluginId: 'http',
      kind: 'telemetry-source',
      name: 'HTTP',
      config: {},
      credentials: {},
      encryptionKey: KEY,
    })
    await deletePluginInstance(db, created.id)
    expect(await getPluginInstance(db, created.id)).toBeUndefined()
  })
})

describe('getMemberRole', () => {
  it('returns the role for a member and null otherwise', async () => {
    const db = await createTestDb()
    const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
    const user = await createUser(db, { email: 'a@example.com', password: 'pw-123456', name: 'A' })
    expect(await getMemberRole(db, { orgId: org.id, userId: user.id })).toBeNull()
    await addMember(db, { orgId: org.id, userId: user.id, role: 'admin' })
    expect(await getMemberRole(db, { orgId: org.id, userId: user.id })).toBe('admin')
  })
})
