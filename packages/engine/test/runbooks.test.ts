import { createOrganization, createProject, createTestDb, searchMemory, type Db } from '@smokejumper/db'
import { describe, expect, it } from 'vitest'
import { chunkRunbook, embedRunbook } from '../src/runbooks'

describe('chunkRunbook', () => {
  it('returns an empty array for empty or whitespace-only content', () => {
    expect(chunkRunbook('')).toEqual([])
    expect(chunkRunbook('   \n\n   ')).toEqual([])
  })

  it('returns a single chunk for content under the window size', () => {
    const content = 'Step 1. Restart the service.\n\nStep 2. Check the logs.'
    expect(chunkRunbook(content)).toEqual([content])
  })

  it('packs consecutive paragraphs into one chunk until the ~800-char window is exceeded', () => {
    const paragraph = 'x'.repeat(390)
    const content = [paragraph, paragraph, paragraph].join('\n\n')
    const chunks = chunkRunbook(content)
    expect(chunks).toEqual([`${paragraph}\n\n${paragraph}`, paragraph])
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(800)
  })

  it('splits a single oversized paragraph on line boundaries', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `segment-${i}-` + 'x'.repeat(60))
    const content = lines.join('\n')
    const chunks = chunkRunbook(content)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('\n')).toBe(content)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(800)
  })

  it('is deterministic for the same input', () => {
    const content = `${'a'.repeat(1000)}\n\n${'b'.repeat(1000)}`
    expect(chunkRunbook(content)).toEqual(chunkRunbook(content))
  })
})

const embedder = async () => new Array<number>(1536).fill(0.3)

async function setup(): Promise<{ db: Db; projectId: string }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  return { db, projectId: project.id }
}

describe('embedRunbook', () => {
  it('is a no-op returning 0 chunks when no embedder is configured', async () => {
    const { db, projectId } = await setup()
    const count = await embedRunbook({
      db,
      runbookId: 'rb-1',
      projectId,
      title: 'Restart guide',
      content: 'Step 1. Restart the pods.',
    })
    expect(count).toBe(0)
    expect(await searchMemory(db, { projectId, embedding: await embedder(), limit: 5 })).toHaveLength(0)
  })

  it('chunks, embeds, and stores each chunk as a runbook memory entry', async () => {
    const { db, projectId } = await setup()
    const content = 'Step 1. Restart the pods.\n\nStep 2. Check the logs for OOM errors.'
    const count = await embedRunbook({
      db,
      embedder,
      runbookId: 'rb-1',
      projectId,
      title: 'Restart guide',
      content,
    })
    expect(count).toBe(chunkRunbook(content).length)
    const entries = await searchMemory(db, { projectId, embedding: await embedder(), limit: 10 })
    expect(entries).toHaveLength(count)
    for (const entry of entries) {
      expect(entry.kind).toBe('runbook')
      expect(entry.metadata).toMatchObject({ runbookId: 'rb-1', title: 'Restart guide' })
    }
  })

  it('clears previously embedded chunks before re-embedding (idempotent per content)', async () => {
    const { db, projectId } = await setup()
    await embedRunbook({
      db,
      embedder,
      runbookId: 'rb-1',
      projectId,
      title: 'Restart guide',
      content: 'a'.repeat(2000),
    })
    const secondCount = await embedRunbook({
      db,
      embedder,
      runbookId: 'rb-1',
      projectId,
      title: 'Restart guide',
      content: 'short content',
    })
    expect(secondCount).toBe(1)
    const entries = await searchMemory(db, { projectId, embedding: await embedder(), limit: 20 })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.content).toBe('short content')
  })
})
