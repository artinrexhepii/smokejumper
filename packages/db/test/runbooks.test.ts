import { describe, expect, it } from 'vitest'
import {
  addMemoryEntry,
  createOrganization,
  createProject,
  createRunbook,
  createTestDb,
  deleteRunbook,
  deleteRunbookChunks,
  getRunbook,
  listRunbooks,
  searchRunbookChunks,
  setRunbookChunkCount,
  type Db,
} from '../src/index.ts'

async function setup(): Promise<{ db: Db; projectId: string }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  return { db, projectId: project.id }
}

describe('createRunbook / listRunbooks / getRunbook', () => {
  it('creates a runbook with a zero chunk count and retrieves it', async () => {
    const { db, projectId } = await setup()
    const runbook = await createRunbook(db, {
      projectId,
      title: 'Restarting the API',
      sourceKind: 'paste',
      content: 'Step 1. Restart the pods.\n\nStep 2. Check logs.',
    })
    expect(runbook.chunkCount).toBe(0)
    expect(runbook.sourceRef).toBeNull()
    expect(await getRunbook(db, runbook.id)).toMatchObject({ title: 'Restarting the API' })
    expect(await listRunbooks(db, projectId)).toHaveLength(1)
  })

  it('stores an optional sourceRef for url runbooks', async () => {
    const { db, projectId } = await setup()
    const runbook = await createRunbook(db, {
      projectId,
      title: 'Wiki guide',
      sourceKind: 'url',
      sourceRef: 'https://wiki.example.com/runbook',
      content: 'fetched content',
    })
    expect(runbook.sourceRef).toBe('https://wiki.example.com/runbook')
  })

  it('returns undefined for an unknown id', async () => {
    const { db } = await setup()
    expect(await getRunbook(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined()
  })
})

describe('setRunbookChunkCount', () => {
  it('updates the chunk count', async () => {
    const { db, projectId } = await setup()
    const runbook = await createRunbook(db, { projectId, title: 'R', sourceKind: 'paste', content: 'x' })
    await setRunbookChunkCount(db, runbook.id, 3)
    expect((await getRunbook(db, runbook.id))!.chunkCount).toBe(3)
  })
})

describe('searchRunbookChunks', () => {
  it('ranks runbook chunks by similarity, scoped to the project and kind=runbook', async () => {
    const { db, projectId } = await setup()
    const runbook = await createRunbook(db, {
      projectId,
      title: 'Restart guide',
      sourceKind: 'paste',
      content: 'restart the service',
    })
    await addMemoryEntry(db, {
      projectId,
      kind: 'runbook',
      content: 'restart the service by running systemctl restart api',
      embedding: new Array(1536).fill(0.2),
      metadata: { runbookId: runbook.id, title: runbook.title, chunkIndex: 0 },
    })
    await addMemoryEntry(db, {
      projectId,
      kind: 'incident',
      content: 'unrelated incident memory',
      embedding: new Array(1536).fill(0.2),
      metadata: {},
    })
    const results = await searchRunbookChunks(db, { projectId, embedding: new Array(1536).fill(0.2) })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ runbookId: runbook.id, title: 'Restart guide' })
    expect(results[0]!.similarity).toBeGreaterThan(0.99)
  })

  it('defaults to a limit of 5', async () => {
    const { db, projectId } = await setup()
    const runbook = await createRunbook(db, { projectId, title: 'R', sourceKind: 'paste', content: 'x' })
    for (let i = 0; i < 7; i++) {
      await addMemoryEntry(db, {
        projectId,
        kind: 'runbook',
        content: `chunk ${i}`,
        embedding: new Array(1536).fill(0.3),
        metadata: { runbookId: runbook.id, title: runbook.title, chunkIndex: i },
      })
    }
    expect(await searchRunbookChunks(db, { projectId, embedding: new Array(1536).fill(0.3) })).toHaveLength(5)
  })
})

describe('deleteRunbookChunks', () => {
  it('removes only the chunks for the given runbook id', async () => {
    const { db, projectId } = await setup()
    const rbA = await createRunbook(db, { projectId, title: 'A', sourceKind: 'paste', content: 'a' })
    const rbB = await createRunbook(db, { projectId, title: 'B', sourceKind: 'paste', content: 'b' })
    await addMemoryEntry(db, {
      projectId,
      kind: 'runbook',
      content: 'chunk a',
      embedding: new Array(1536).fill(0.1),
      metadata: { runbookId: rbA.id, title: 'A', chunkIndex: 0 },
    })
    await addMemoryEntry(db, {
      projectId,
      kind: 'runbook',
      content: 'chunk b',
      embedding: new Array(1536).fill(0.1),
      metadata: { runbookId: rbB.id, title: 'B', chunkIndex: 0 },
    })
    await deleteRunbookChunks(db, rbA.id)
    const remaining = await searchRunbookChunks(db, { projectId, embedding: new Array(1536).fill(0.1), limit: 10 })
    expect(remaining.map((r) => r.runbookId)).toEqual([rbB.id])
  })
})

describe('deleteRunbook', () => {
  it('deletes the runbook row and its chunks', async () => {
    const { db, projectId } = await setup()
    const runbook = await createRunbook(db, { projectId, title: 'R', sourceKind: 'paste', content: 'x' })
    await addMemoryEntry(db, {
      projectId,
      kind: 'runbook',
      content: 'chunk',
      embedding: new Array(1536).fill(0.1),
      metadata: { runbookId: runbook.id, title: 'R', chunkIndex: 0 },
    })
    await deleteRunbook(db, runbook.id)
    expect(await getRunbook(db, runbook.id)).toBeUndefined()
    const remaining = await searchRunbookChunks(db, { projectId, embedding: new Array(1536).fill(0.1) })
    expect(remaining).toHaveLength(0)
  })
})
