import { describe, expect, it } from 'vitest'
import {
  addMember,
  countOwners,
  countUsers,
  createInvite,
  createOrganization,
  createTestDb,
  createUser,
  getInviteById,
  getInviteByTokenHash,
  listInvites,
  listMembers,
  markInviteAccepted,
  removeMember,
  revokeInvite,
  setMemberRole,
  updateOrganization,
} from '../src/index.ts'

describe('tenancy helpers', () => {
  it('counts users and owners, and lists/updates/removes members', async () => {
    const db = await createTestDb()
    expect(await countUsers(db)).toBe(0)
    const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
    const owner = await createUser(db, { email: 'o@example.com', password: 'pw-123456', name: 'Owner' })
    const member = await createUser(db, { email: 'm@example.com', password: 'pw-123456', name: 'Mem' })
    await addMember(db, { orgId: org.id, userId: owner.id, role: 'owner' })
    await addMember(db, { orgId: org.id, userId: member.id, role: 'member' })

    expect(await countUsers(db)).toBe(2)
    expect(await countOwners(db, org.id)).toBe(1)

    const members = await listMembers(db, org.id)
    expect(members.map((m) => m.email).sort()).toEqual(['m@example.com', 'o@example.com'])
    expect(members.find((m) => m.userId === member.id)?.role).toBe('member')

    await setMemberRole(db, { orgId: org.id, userId: member.id, role: 'admin' })
    expect((await listMembers(db, org.id)).find((m) => m.userId === member.id)?.role).toBe('admin')

    await removeMember(db, { orgId: org.id, userId: member.id })
    expect((await listMembers(db, org.id)).map((m) => m.userId)).toEqual([owner.id])
  })

  it('renames an organization without changing its slug', async () => {
    const db = await createTestDb()
    const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
    const updated = await updateOrganization(db, org.id, { name: 'Acme Inc' })
    expect(updated.name).toBe('Acme Inc')
    expect(updated.slug).toBe('acme')
  })

  it('creates, looks up, lists, accepts, and revokes invites', async () => {
    const db = await createTestDb()
    const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
    const owner = await createUser(db, { email: 'o@example.com', password: 'pw-123456', name: 'Owner' })
    await addMember(db, { orgId: org.id, userId: owner.id, role: 'owner' })

    const invite = await createInvite(db, {
      orgId: org.id,
      email: 'new@example.com',
      role: 'member',
      tokenHash: 'hash-abc',
      createdBy: owner.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    })
    expect(await getInviteById(db, invite.id)).toMatchObject({ tokenHash: 'hash-abc', role: 'member' })
    expect(await getInviteByTokenHash(db, 'hash-abc')).toMatchObject({ id: invite.id })
    expect((await listInvites(db, org.id)).map((i) => i.id)).toEqual([invite.id])

    const joiner = await createUser(db, { email: 'new@example.com', password: 'pw-123456', name: 'New' })
    await markInviteAccepted(db, invite.id, joiner.id)
    expect(await listInvites(db, org.id)).toEqual([])
    expect((await getInviteById(db, invite.id))?.acceptedBy).toBe(joiner.id)

    const expired = await createInvite(db, {
      orgId: org.id,
      role: 'member',
      tokenHash: 'hash-old',
      createdBy: owner.id,
      expiresAt: new Date(Date.now() - 1000),
    })
    expect((await listInvites(db, org.id)).map((i) => i.id)).not.toContain(expired.id)

    await revokeInvite(db, expired.id)
    expect(await getInviteById(db, expired.id)).toBeUndefined()
  })
})
