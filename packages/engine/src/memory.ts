import { addMemoryEntry, searchMemory, type Db } from '@smokejumper/db'

export type Embedder = (text: string) => Promise<number[]>

export async function recallSimilarIncidents(opts: {
  db: Db
  projectId: string
  embedder?: Embedder
  query: string
  limit?: number
}): Promise<Array<{ content: string; similarity: number }>> {
  if (!opts.embedder) return []
  const embedding = await opts.embedder(opts.query)
  const entries = await searchMemory(opts.db, {
    projectId: opts.projectId,
    embedding,
    limit: opts.limit ?? 3,
  })
  return entries.map((entry) => ({ content: entry.content, similarity: entry.similarity }))
}

export async function storeIncidentMemory(opts: {
  db: Db
  projectId: string
  embedder?: Embedder
  title: string
  rootCause: string
  metadata: Record<string, unknown>
}): Promise<void> {
  if (!opts.embedder) return
  const content = `${opts.title}\n${opts.rootCause}`
  const embedding = await opts.embedder(content)
  await addMemoryEntry(opts.db, {
    projectId: opts.projectId,
    kind: 'incident',
    content,
    embedding,
    metadata: opts.metadata,
  })
}
