import { desc, eq } from 'drizzle-orm'
import type { Db } from './db.ts'
import { auditLog, type AuditActorType, type AuditEntry } from './schema.ts'

export async function appendAudit(
  db: Db,
  entry: {
    orgId: string
    actorType: AuditActorType
    actorId: string
    action: string
    subjectType: string
    subjectId: string
    detail: Record<string, unknown>
  },
): Promise<void> {
  await db.insert(auditLog).values(entry)
}

export async function listAudit(db: Db, input: { orgId: string; limit?: number }): Promise<AuditEntry[]> {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.orgId, input.orgId))
    .orderBy(desc(auditLog.id))
    .limit(input.limit ?? 100)
}
