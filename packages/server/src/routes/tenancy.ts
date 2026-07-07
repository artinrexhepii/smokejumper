import { createHash, randomBytes } from 'node:crypto'
import {
  addMember,
  appendAudit,
  countOwners,
  countUsers,
  createInvite,
  createOrganization,
  createSession,
  createUser,
  getInviteById,
  getInviteByTokenHash,
  getMemberRole,
  getOrganizationById,
  getPrimaryOrganization,
  getUserByEmail,
  listInvites,
  listMembers,
  markInviteAccepted,
  removeMember,
  revokeInvite,
  setMemberRole,
  updateOrganization,
} from '@smokejumper/db'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { slugify } from '../routes.ts'
import { setSessionCookie, toPublicUser, type ServerDeps } from '../server.ts'

const roleSchema = z.enum(['owner', 'admin', 'member'])
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function sha256hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function signupEnabled(): boolean {
  return process.env.SMOKEJUMPER_ALLOW_SIGNUP === '1'
}

function emailDomainAllowed(email: string): boolean {
  const raw = process.env.SMOKEJUMPER_SIGNUP_ALLOWED_DOMAINS
  if (!raw) return true
  const allowed = raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
  if (allowed.length === 0) return true
  const at = email.lastIndexOf('@')
  return at >= 0 && allowed.includes(email.slice(at + 1).toLowerCase())
}

function dashboardBase(): string {
  return process.env.DASHBOARD_URL ?? process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000'
}

// Returns the caller's role for the org if they are an owner/admin; otherwise
// sends the appropriate 403 and returns null.
async function requireManager(
  deps: ServerDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  orgId: string,
): Promise<'owner' | 'admin' | null> {
  if (!request.auth!.orgIds.includes(orgId)) {
    reply.code(403).send({ error: 'forbidden' })
    return null
  }
  const role = await getMemberRole(deps.db, { orgId, userId: request.auth!.user.id })
  if (role !== 'owner' && role !== 'admin') {
    reply.code(403).send({ error: 'only owners and admins can manage the team' })
    return null
  }
  return role
}

const setupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().trim().min(1),
  orgName: z.string().trim().min(1).max(80),
})

const signupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().trim().min(1),
})

const inviteBody = z.object({
  email: z.string().email().optional(),
  role: roleSchema,
})

const acceptBody = z.object({
  name: z.string().trim().min(1),
  password: z.string().min(8),
  email: z.string().email().optional(),
})

const roleBody = z.object({ role: roleSchema })
const renameBody = z.object({ name: z.string().trim().min(1).max(80) })

export function registerTenancyRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // ---- first-run setup (public, only on an empty install) ----
  app.post('/api/setup', async (request, reply) => {
    if ((await countUsers(deps.db)) > 0) {
      return reply.code(409).send({ error: 'setup already completed' })
    }
    const parsed = setupBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })
    const { email, password, name, orgName } = parsed.data
    const org = await createOrganization(deps.db, { name: orgName, slug: slugify(orgName) || 'org' })
    const user = await createUser(deps.db, { email, password, name })
    await addMember(deps.db, { orgId: org.id, userId: user.id, role: 'owner' })
    await appendAudit(deps.db, {
      orgId: org.id,
      actorType: 'user',
      actorId: user.id,
      action: 'user.setup',
      subjectType: 'user',
      subjectId: user.id,
      detail: { email, orgName },
    })
    const { token, expiresAt } = await createSession(deps.db, user.id)
    setSessionCookie(reply, token, expiresAt)
    return reply.code(201).send({ user: toPublicUser(user) })
  })

  // ---- open self-service signup (public, only when enabled) ----
  app.post('/api/auth/signup', async (request, reply) => {
    if (!signupEnabled()) return reply.code(404).send({ error: 'signup disabled' })
    const parsed = signupBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })
    const { email, password, name } = parsed.data
    if (!emailDomainAllowed(email)) return reply.code(403).send({ error: 'email domain not allowed' })
    if (await getUserByEmail(deps.db, email)) {
      return reply.code(409).send({ error: 'email already registered' })
    }
    const org = await getPrimaryOrganization(deps.db)
    if (!org) return reply.code(409).send({ error: 'no organization to join' })
    const user = await createUser(deps.db, { email, password, name })
    await addMember(deps.db, { orgId: org.id, userId: user.id, role: 'member' })
    await appendAudit(deps.db, {
      orgId: org.id,
      actorType: 'user',
      actorId: user.id,
      action: 'user.signup',
      subjectType: 'user',
      subjectId: user.id,
      detail: { email },
    })
    const { token, expiresAt } = await createSession(deps.db, user.id)
    setSessionCookie(reply, token, expiresAt)
    return reply.code(201).send({ user: toPublicUser(user) })
  })

  // ---- invites (owner/admin) ----
  app.post('/api/orgs/:orgId/invites', async (request, reply) => {
    const { orgId } = request.params as { orgId: string }
    if (!(await requireManager(deps, request, reply, orgId))) return
    const parsed = inviteBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })
    const rawToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
    const invite = await createInvite(deps.db, {
      orgId,
      email: parsed.data.email ?? null,
      role: parsed.data.role,
      tokenHash: sha256hex(rawToken),
      createdBy: request.auth!.user.id,
      expiresAt,
    })
    await appendAudit(deps.db, {
      orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'member.invite',
      subjectType: 'invite',
      subjectId: invite.id,
      detail: { role: invite.role, email: invite.email },
    })
    return reply.code(201).send({
      id: invite.id,
      role: invite.role,
      email: invite.email,
      token: rawToken,
      url: `${dashboardBase()}/join/${rawToken}`,
      expiresAt: invite.expiresAt,
    })
  })

  app.get('/api/orgs/:orgId/invites', async (request, reply) => {
    const { orgId } = request.params as { orgId: string }
    if (!(await requireManager(deps, request, reply, orgId))) return
    const list = await listInvites(deps.db, orgId)
    return list.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
    }))
  })

  app.delete('/api/orgs/:orgId/invites/:inviteId', async (request, reply) => {
    const { orgId, inviteId } = request.params as { orgId: string; inviteId: string }
    if (!(await requireManager(deps, request, reply, orgId))) return
    const invite = await getInviteById(deps.db, inviteId)
    if (!invite || invite.orgId !== orgId) return reply.code(404).send({ error: 'not found' })
    await revokeInvite(deps.db, inviteId)
    await appendAudit(deps.db, {
      orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'member.invite.revoke',
      subjectType: 'invite',
      subjectId: inviteId,
      detail: {},
    })
    return reply.code(204).send()
  })

  // ---- invite preview + accept (public) ----
  app.get('/api/invites/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const invite = await getInviteByTokenHash(deps.db, sha256hex(token))
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return reply.send({ valid: false })
    }
    const org = await getOrganizationById(deps.db, invite.orgId)
    return reply.send({
      valid: true,
      orgName: org?.name ?? 'the organization',
      role: invite.role,
      email: invite.email,
    })
  })

  app.post('/api/invites/:token/accept', async (request, reply) => {
    const { token } = request.params as { token: string }
    const invite = await getInviteByTokenHash(deps.db, sha256hex(token))
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return reply.code(410).send({ error: 'this invite is no longer valid' })
    }
    const parsed = acceptBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })
    const email = invite.email ?? parsed.data.email
    if (!email) return reply.code(400).send({ error: 'email is required' })
    if (invite.email && parsed.data.email && parsed.data.email.toLowerCase() !== invite.email.toLowerCase()) {
      return reply.code(400).send({ error: 'email does not match the invite' })
    }
    if (await getUserByEmail(deps.db, email)) {
      return reply.code(409).send({ error: 'email already registered' })
    }
    const user = await createUser(deps.db, { email, password: parsed.data.password, name: parsed.data.name })
    await addMember(deps.db, { orgId: invite.orgId, userId: user.id, role: invite.role })
    await markInviteAccepted(deps.db, invite.id, user.id)
    await appendAudit(deps.db, {
      orgId: invite.orgId,
      actorType: 'user',
      actorId: user.id,
      action: 'member.join',
      subjectType: 'user',
      subjectId: user.id,
      detail: { email, role: invite.role },
    })
    const { token: sessionToken, expiresAt } = await createSession(deps.db, user.id)
    setSessionCookie(reply, sessionToken, expiresAt)
    return reply.code(201).send({ user: toPublicUser(user) })
  })

  // ---- members ----
  app.get('/api/orgs/:orgId/members', async (request, reply) => {
    const { orgId } = request.params as { orgId: string }
    if (!request.auth!.orgIds.includes(orgId)) return reply.code(403).send({ error: 'forbidden' })
    return listMembers(deps.db, orgId)
  })

  app.patch('/api/orgs/:orgId/members/:userId', async (request, reply) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string }
    if (!(await requireManager(deps, request, reply, orgId))) return
    const parsed = roleBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })
    const targetRole = await getMemberRole(deps.db, { orgId, userId })
    if (!targetRole) return reply.code(404).send({ error: 'not a member' })
    if (targetRole === 'owner' && parsed.data.role !== 'owner' && (await countOwners(deps.db, orgId)) <= 1) {
      return reply.code(409).send({ error: 'cannot demote the last owner' })
    }
    await setMemberRole(deps.db, { orgId, userId, role: parsed.data.role })
    await appendAudit(deps.db, {
      orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'member.role',
      subjectType: 'user',
      subjectId: userId,
      detail: { role: parsed.data.role },
    })
    return reply.code(204).send()
  })

  app.delete('/api/orgs/:orgId/members/:userId', async (request, reply) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string }
    if (!(await requireManager(deps, request, reply, orgId))) return
    const targetRole = await getMemberRole(deps.db, { orgId, userId })
    if (!targetRole) return reply.code(404).send({ error: 'not a member' })
    if (targetRole === 'owner' && (await countOwners(deps.db, orgId)) <= 1) {
      return reply.code(409).send({ error: 'cannot remove the last owner' })
    }
    await removeMember(deps.db, { orgId, userId })
    await appendAudit(deps.db, {
      orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'member.remove',
      subjectType: 'user',
      subjectId: userId,
      detail: {},
    })
    return reply.code(204).send()
  })

  // ---- org rename (owner only) ----
  app.patch('/api/orgs/:orgId', async (request, reply) => {
    const { orgId } = request.params as { orgId: string }
    if (!request.auth!.orgIds.includes(orgId)) return reply.code(403).send({ error: 'forbidden' })
    const role = await getMemberRole(deps.db, { orgId, userId: request.auth!.user.id })
    if (role !== 'owner') return reply.code(403).send({ error: 'only owners can rename the organization' })
    const parsed = renameBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })
    const org = await updateOrganization(deps.db, orgId, { name: parsed.data.name })
    await appendAudit(deps.db, {
      orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'org.rename',
      subjectType: 'org',
      subjectId: orgId,
      detail: { name: parsed.data.name },
    })
    return org
  })
}
