import { and, cosineDistance, desc, eq, sql } from 'drizzle-orm'
import type { Db } from './db.ts'
import { memoryEntries, runbooks, type Runbook, type RunbookSourceKind } from './schema.ts'

export async function createRunbook(
  db: Db,
  input: {
    projectId: string
    title: string
    sourceKind: RunbookSourceKind
    sourceRef?: string
    content: string
  },
): Promise<Runbook> {
  const [runbook] = await db
    .insert(runbooks)
    .values({
      projectId: input.projectId,
      title: input.title,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      content: input.content,
    })
    .returning()
  return runbook!
}

export async function listRunbooks(db: Db, projectId: string): Promise<Runbook[]> {
  return db.select().from(runbooks).where(eq(runbooks.projectId, projectId)).orderBy(desc(runbooks.createdAt))
}

export async function getRunbook(db: Db, id: string): Promise<Runbook | undefined> {
  const [runbook] = await db.select().from(runbooks).where(eq(runbooks.id, id))
  return runbook
}

export async function setRunbookChunkCount(db: Db, id: string, chunkCount: number): Promise<void> {
  await db.update(runbooks).set({ chunkCount, updatedAt: new Date() }).where(eq(runbooks.id, id))
}

export async function deleteRunbookChunks(db: Db, runbookId: string): Promise<void> {
  await db.delete(memoryEntries).where(sql`${memoryEntries.metadata}->>'runbookId' = ${runbookId}`)
}

export async function deleteRunbook(db: Db, id: string): Promise<void> {
  await deleteRunbookChunks(db, id)
  await db.delete(runbooks).where(eq(runbooks.id, id))
}

export async function searchRunbookChunks(
  db: Db,
  input: { projectId: string; embedding: number[]; limit?: number },
): Promise<Array<{ content: string; similarity: number; runbookId: string; title: string }>> {
  const similarity = sql<number>`1 - (${cosineDistance(memoryEntries.embedding, input.embedding)})`
  const rows = await db
    .select({ content: memoryEntries.content, metadata: memoryEntries.metadata, similarity })
    .from(memoryEntries)
    .where(and(eq(memoryEntries.projectId, input.projectId), eq(memoryEntries.kind, 'runbook')))
    .orderBy(desc(similarity))
    .limit(input.limit ?? 5)
  return rows.map((row) => ({
    content: row.content,
    similarity: row.similarity,
    runbookId: String(row.metadata.runbookId ?? ''),
    title: String(row.metadata.title ?? ''),
  }))
}
