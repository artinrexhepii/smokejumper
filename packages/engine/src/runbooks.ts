import { addMemoryEntry, deleteRunbookChunks, type Db } from '@smokejumper/db'
import type { Embedder } from './memory'

const CHUNK_TARGET_SIZE = 800

function packOnBoundary(units: string[], joiner: string): string[] {
  const chunks: string[] = []
  let current = ''
  for (const unit of units) {
    const candidate = current ? `${current}${joiner}${unit}` : unit
    // a single unit longer than the target window is kept whole rather than dropped
    // or split mid-word; it becomes its own (oversized) chunk.
    if (candidate.length <= CHUNK_TARGET_SIZE || current === '') {
      current = candidate
    } else {
      chunks.push(current)
      current = unit
    }
  }
  if (current !== '') chunks.push(current)
  return chunks
}

export async function embedRunbook(opts: {
  db: Db
  embedder?: Embedder
  runbookId: string
  projectId: string
  title: string
  content: string
}): Promise<number> {
  if (!opts.embedder) return 0
  await deleteRunbookChunks(opts.db, opts.runbookId)
  const chunks = chunkRunbook(opts.content)
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const embedding = await opts.embedder(chunk)
    await addMemoryEntry(opts.db, {
      projectId: opts.projectId,
      kind: 'runbook',
      content: chunk,
      embedding,
      metadata: { runbookId: opts.runbookId, title: opts.title, chunkIndex },
    })
  }
  return chunks.length
}

export function chunkRunbook(content: string): string[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)

  const chunks: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_TARGET_SIZE) {
      if (current !== '') {
        chunks.push(current)
        current = ''
      }
      chunks.push(...packOnBoundary(paragraph.split('\n'), '\n'))
      continue
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length <= CHUNK_TARGET_SIZE) {
      current = candidate
    } else {
      chunks.push(current)
      current = paragraph
    }
  }
  if (current !== '') chunks.push(current)
  return chunks
}
