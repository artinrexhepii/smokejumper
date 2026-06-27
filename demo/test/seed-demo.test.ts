import { describe, expect, it } from 'vitest'
import {
  addMember,
  createOrganization,
  createProject,
  createTestDb,
  createUser,
  getDecryptedConfig,
  getPluginInstance,
} from '@smokejumper/db'
import { DEMO_INSTANCE_IDS, findDemoProject, seedDemoInstances } from '../src/seed-demo'

const KEY = Buffer.alloc(32, 3).toString('base64')

async function seedBase(db: Awaited<ReturnType<typeof createTestDb>>) {
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const user = await createUser(db, { email: 'admin@example.com', password: 'smokejumper', name: 'Admin' })
  await addMember(db, { orgId: org.id, userId: user.id, role: 'owner' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  return { org, user, project }
}

describe('seedDemoInstances', () => {
  it('creates the three demo instances with fixed ids and the pinned configs', async () => {
    const db = await createTestDb()
    const { project } = await seedBase(db)
    const ids = await seedDemoInstances(db, { projectId: project.id, encryptionKey: KEY })
    expect(ids).toEqual(DEMO_INSTANCE_IDS)

    const webhook = await getPluginInstance(db, DEMO_INSTANCE_IDS.webhook)
    expect(webhook).toBeDefined()
    expect(webhook!.pluginId).toBe('webhook')
    expect(getDecryptedConfig(webhook!, KEY)).toEqual({ token: 'demo-token' })

    const docker = await getPluginInstance(db, DEMO_INSTANCE_IDS.docker)
    expect(docker!.pluginId).toBe('docker')
    expect(getDecryptedConfig(docker!, KEY)).toEqual({ host: 'http://docker-proxy:2375' })

    const http = await getPluginInstance(db, DEMO_INSTANCE_IDS.http)
    expect(http!.pluginId).toBe('http')
    expect(getDecryptedConfig(http!, KEY)).toEqual({})
  })

  it('is idempotent', async () => {
    const db = await createTestDb()
    const { project } = await seedBase(db)
    const first = await seedDemoInstances(db, { projectId: project.id, encryptionKey: KEY })
    const second = await seedDemoInstances(db, { projectId: project.id, encryptionKey: KEY })
    expect(second).toEqual(first)
  })
})

describe('findDemoProject', () => {
  it('finds the demo project via the seeded admin credentials', async () => {
    const db = await createTestDb()
    const { project } = await seedBase(db)
    const found = await findDemoProject(db)
    expect(found.projectId).toBe(project.id)
  })

  it('fails with a pointer to the base seed when it has not run', async () => {
    const db = await createTestDb()
    await expect(findDemoProject(db)).rejects.toThrow(/server seed/)
  })
})
