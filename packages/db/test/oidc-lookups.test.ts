import { describe, expect, it } from 'vitest'
import {
  createOrganization,
  createTestDb,
  createUser,
  getOrganizationBySlug,
  getUserByEmail,
} from '../src/index.ts'

describe('oidc identity lookups', () => {
  it('finds a user by email and returns undefined when absent', async () => {
    const db = await createTestDb()
    const user = await createUser(db, {
      email: 'sso@example.com',
      password: 'pw-123456',
      name: 'SSO User',
    })
    expect((await getUserByEmail(db, 'sso@example.com'))?.id).toBe(user.id)
    expect(await getUserByEmail(db, 'missing@example.com')).toBeUndefined()
  })

  it('finds an organization by slug and returns undefined when absent', async () => {
    const db = await createTestDb()
    const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
    expect((await getOrganizationBySlug(db, 'acme'))?.id).toBe(org.id)
    expect(await getOrganizationBySlug(db, 'nope')).toBeUndefined()
  })
})
