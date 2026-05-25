import { cosineDistance, desc, eq, getTableColumns, sql } from 'drizzle-orm'
import type { Db } from './db.ts'
import { memoryEntries, type MemoryEntry, type MemoryKind } from './schema.ts'

export async function addMemoryEntry(
  db: Db,
  input: {
    projectId: string
    kind: MemoryKind
    content: string
    embedding: number[]
    metadata: Record<string, unknown>
  },
): Promise<MemoryEntry> {
  const [entry] = await db.insert(memoryEntries).values(input).returning()
  return entry!
}

export async function searchMemory(
  db: Db,
  input: { projectId: string; embedding: number[]; limit?: number },
): Promise<Array<MemoryEntry & { similarity: number }>> {
  const similarity = sql<number>`1 - (${cosineDistance(memoryEntries.embedding, input.embedding)})`
  return db
    .select({ ...getTableColumns(memoryEntries), similarity })
    .from(memoryEntries)
    .where(eq(memoryEntries.projectId, input.projectId))
    .orderBy(desc(similarity))
    .limit(input.limit ?? 5)
}
