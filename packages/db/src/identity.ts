import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Db } from './db.ts'
import {
  organizations,
  orgMemberships,
  projects,
  sessions,
  users,
  type Organization,
  type OrgRole,
  type Project,
  type User,
} from './schema.ts'

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}

export async function createOrganization(
  db: Db,
  input: { name: string; slug: string },
): Promise<Organization> {
  const [org] = await db.insert(organizations).values(input).returning()
  return org!
}

export async function getOrganizationBySlug(db: Db, slug: string): Promise<Organization | undefined> {
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug))
  return org
}

export async function createUser(
  db: Db,
  input: { email: string; password: string; name: string },
): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ email: input.email, passwordHash: hashPassword(input.password), name: input.name })
    .returning()
  return user!
}

export async function getUserByEmail(db: Db, email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email))
  return user
}

export async function addMember(
  db: Db,
  input: { orgId: string; userId: string; role: OrgRole },
): Promise<void> {
  await db.insert(orgMemberships).values(input).onConflictDoNothing()
}

export async function verifyCredentials(
  db: Db,
  input: { email: string; password: string },
): Promise<User | null> {
  const user = await getUserByEmail(db, input.email)
  if (!user || !verifyPassword(input.password, user.passwordHash)) return null
  return user
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.insert(sessions).values({ token, userId, expiresAt })
  return { token, expiresAt }
}

export async function getSession(
  db: Db,
  token: string,
): Promise<{ user: User; orgIds: string[] } | null> {
  const [session] = await db.select().from(sessions).where(eq(sessions.token, token))
  if (!session || session.expiresAt.getTime() <= Date.now()) return null
  const [user] = await db.select().from(users).where(eq(users.id, session.userId))
  if (!user) return null
  const memberships = await db
    .select()
    .from(orgMemberships)
    .where(eq(orgMemberships.userId, user.id))
  return { user, orgIds: memberships.map((m) => m.orgId) }
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token))
}

export async function listOrganizationsForUser(db: Db, userId: string): Promise<Organization[]> {
  const rows = await db
    .select({ org: organizations })
    .from(orgMemberships)
    .innerJoin(organizations, eq(orgMemberships.orgId, organizations.id))
    .where(eq(orgMemberships.userId, userId))
  return rows.map((r) => r.org)
}

export async function createProject(
  db: Db,
  input: { orgId: string; name: string; slug: string },
): Promise<Project> {
  const [project] = await db.insert(projects).values(input).returning()
  return project!
}

export async function getProject(db: Db, projectId: string): Promise<Project | undefined> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
  return project
}

export async function getProjectBySlug(db: Db, orgId: string, slug: string): Promise<Project | undefined> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.slug, slug)))
  return project
}

export async function listProjects(db: Db, orgId: string): Promise<Project[]> {
  return db.select().from(projects).where(eq(projects.orgId, orgId))
}

export async function getMemberRole(
  db: Db,
  input: { orgId: string; userId: string },
): Promise<OrgRole | null> {
  const [row] = await db
    .select({ role: orgMemberships.role })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, input.orgId), eq(orgMemberships.userId, input.userId)))
  return row?.role ?? null
}
