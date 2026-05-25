import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'

export const migrationsTable = pgTable('_migrations', {
  name: text('name').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
})

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Organization = typeof organizations.$inferSelect

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type User = typeof users.$inferSelect

export type OrgRole = 'owner' | 'admin' | 'member'

export const orgMemberships = pgTable(
  'org_memberships',
  {
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: text('role').$type<OrgRole>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
)

export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export type Session = typeof sessions.$inferSelect

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.slug)],
)

export type Project = typeof projects.$inferSelect

export const pluginInstances = pgTable('plugin_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  pluginId: text('plugin_id').notNull(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  credentialsEncrypted: text('credentials_encrypted'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type PluginInstance = typeof pluginInstances.$inferSelect

export type IncidentStatus = 'open' | 'investigating' | 'diagnosed' | 'resolved'

export const incidents = pgTable('incidents', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  status: text('status').$type<IncidentStatus>().notNull().default('open'),
  severity: text('severity').notNull(),
  title: text('title').notNull(),
  service: text('service').notNull(),
  dedupKey: text('dedup_key').notNull(),
  labels: jsonb('labels').$type<Record<string, string>>().notNull().default({}),
  alertCount: integer('alert_count').notNull().default(1),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  lastAlertAt: timestamp('last_alert_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})

export type Incident = typeof incidents.$inferSelect

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  incidentId: uuid('incident_id').notNull().references(() => incidents.id),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Alert = typeof alerts.$inferSelect

export type InvestigationStatus = 'running' | 'completed' | 'failed' | 'budget_exceeded'

export interface InvestigationBudget {
  maxToolCalls: number
  maxWallMs: number
}

export const investigations = pgTable('investigations', {
  id: uuid('id').primaryKey().defaultRandom(),
  incidentId: uuid('incident_id').notNull().references(() => incidents.id),
  status: text('status').$type<InvestigationStatus>().notNull().default('running'),
  budget: jsonb('budget').$type<InvestigationBudget>().notNull(),
  stats: jsonb('stats').$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})

export type Investigation = typeof investigations.$inferSelect

export const evidenceRecords = pgTable(
  'evidence_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    investigationId: uuid('investigation_id').notNull().references(() => investigations.id),
    seq: integer('seq').notNull(),
    toolName: text('tool_name').notNull(),
    input: jsonb('input').notNull(),
    output: jsonb('output').notNull(),
    summary: text('summary').notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.investigationId, t.seq)],
)

export type EvidenceRecord = typeof evidenceRecords.$inferSelect

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  investigationId: uuid('investigation_id').notNull().references(() => investigations.id),
  specialist: text('specialist').notNull(),
  summary: text('summary').notNull(),
  evidenceIds: uuid('evidence_ids').array().notNull().default(sql`'{}'::uuid[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Finding = typeof findings.$inferSelect

export interface EvidenceChainClaim {
  claim: string
  evidenceIds: string[]
  verified: boolean
}

export type DiagnosisVerdict = 'confirmed' | 'rejected' | 'partial'

export const diagnoses = pgTable(
  'diagnoses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    investigationId: uuid('investigation_id').notNull().references(() => investigations.id),
    version: integer('version').notNull().default(1),
    rootCause: text('root_cause').notNull(),
    confidence: real('confidence').notNull(),
    evidenceChain: jsonb('evidence_chain').$type<EvidenceChainClaim[]>().notNull(),
    remediation: text('remediation').notNull(),
    openQuestions: text('open_questions').array().notNull().default(sql`'{}'::text[]`),
    humanVerdict: text('human_verdict').$type<DiagnosisVerdict>(),
    humanNote: text('human_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.investigationId, t.version)],
)

export type Diagnosis = typeof diagnoses.$inferSelect

export type MemoryKind = 'incident' | 'runbook'

export const memoryEntries = pgTable('memory_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  kind: text('kind').$type<MemoryKind>().notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type MemoryEntry = typeof memoryEntries.$inferSelect

export type AuditActorType = 'user' | 'agent' | 'system'

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  actorType: text('actor_type').$type<AuditActorType>().notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type AuditEntry = typeof auditLog.$inferSelect
