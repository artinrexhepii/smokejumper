import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  addMember,
  createOrganization,
  createProject,
  createSession,
  createTestDb,
  createUser,
  deleteSession,
  getOrganizationBySlug,
  getProject,
  getProjectBySlug,
  getSession,
  getUserByEmail,
  listOrganizationsForUser,
  listProjects,
  sessions,
  verifyCredentials,
} from '../src/index.ts'

describe('identity', () => {
  it('creates orgs, users, memberships, and projects', async () => {
    const db = await createTestDb()
    const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
    expect(org.id).toMatch(/^[0-9a-f-]{36}$/)
    const user = await createUser(db, { email: 'a@example.com', password: 'pw-123456', name: 'A' })
    expect(user.passwordHash).not.toContain('pw-123456')
    await addMember(db, { orgId: org.id, userId: user.id, role: 'owner' })
    await addMember(db, { orgId: org.id, userId: user.id, role: 'owner' })
    const orgs = await listOrganizationsForUser(db, user.id)
    expect(orgs.map((o) => o.id)).toEqual([org.id])
    const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
    expect(await getProject(db, project.id)).toMatchObject({ slug: 'demo' })
    expect((await listProjects(db, org.id)).map((p) => p.id)).toEqual([project.id])
  })

  it('verifies credentials with scrypt', async () => {
    const db = await createTestDb()
    const user = await createUser(db, { email: 'b@example.com', password: 'correct horse', name: 'B' })
    const ok = await verifyCredentials(db, { email: 'b@example.com', password: 'correct horse' })
    expect(ok?.id).toBe(user.id)
    expect(await verifyCredentials(db, { email: 'b@example.com', password: 'wrong' })).toBeNull()
    expect(await verifyCredentials(db, { email: 'missing@example.com', password: 'x' })).toBeNull()
  })

  it('creates, resolves, and deletes sessions', async () => {
    const db = await createTestDb()
    const user = await createUser(db, { email: 'c@example.com', password: 'pw-123456', name: 'C' })
    const org = await createOrganization(db, { name: 'Beta', slug: 'beta' })
    await addMember(db, { orgId: org.id, userId: user.id, role: 'member' })
    const { token, expiresAt } = await createSession(db, user.id)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000)
    const session = await getSession(db, token)
    expect(session?.user.id).toBe(user.id)
    expect(session?.orgIds).toEqual([org.id])
    expect(await getSession(db, 'unknown-token')).toBeNull()
    await deleteSession(db, token)
    expect(await getSession(db, token)).toBeNull()
  })

  it('rejects expired sessions', async () => {
    const db = await createTestDb()
    const user = await createUser(db, { email: 'd@example.com', password: 'pw-123456', name: 'D' })
    const { token } = await createSession(db, user.id)
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.token, token))
    expect(await getSession(db, token)).toBeNull()
  })

  it('looks up orgs, users, and projects by natural keys', async () => {
    const db = await createTestDb()
    const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
    const user = await createUser(db, { email: 'a@example.com', password: 'pw-123456', name: 'A' })
    const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
    expect((await getOrganizationBySlug(db, 'acme'))?.id).toBe(org.id)
    expect(await getOrganizationBySlug(db, 'missing')).toBeUndefined()
    expect((await getUserByEmail(db, 'a@example.com'))?.id).toBe(user.id)
    expect((await getProjectBySlug(db, org.id, 'demo'))?.id).toBe(project.id)
  })
})
