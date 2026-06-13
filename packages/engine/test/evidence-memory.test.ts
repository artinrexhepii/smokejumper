import { createOrganization, createProject, createTestDb } from '@smokejumper/db'
import { describe, expect, it } from 'vitest'
import { filterEvidenceChain } from '../src/evidence-filter'
import { recallSimilarIncidents, storeIncidentMemory } from '../src/memory'

describe('filterEvidenceChain', () => {
  it('keeps only recorded ids and marks claims verified accordingly', () => {
    const chain = filterEvidenceChain(
      [
        { claim: 'memory grew steadily', evidenceIds: ['ev-1', 'ev-1', 'ghost'] },
        { claim: 'deploy was clean', evidenceIds: ['ghost'] },
        { claim: 'no evidence either way', evidenceIds: [] },
      ],
      new Set(['ev-1', 'ev-2']),
    )
    expect(chain).toEqual([
      { claim: 'memory grew steadily', evidenceIds: ['ev-1'], verified: true },
      { claim: 'deploy was clean', evidenceIds: [], verified: false },
      { claim: 'no evidence either way', evidenceIds: [], verified: false },
    ])
  })
})

const embedder = async () => new Array<number>(1536).fill(0.1)

describe('incident memory', () => {
  it('skips recall and storage when no embedder is configured', async () => {
    const db = {} as never
    await expect(recallSimilarIncidents({ db, projectId: 'p', query: 'q' })).resolves.toEqual([])
    await expect(
      storeIncidentMemory({ db, projectId: 'p', title: 't', rootCause: 'r', metadata: {} }),
    ).resolves.toBeUndefined()
  })

  it('stores and recalls incident memory when an embedder is configured', async () => {
    const db = await createTestDb()
    const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
    const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
    await storeIncidentMemory({
      db,
      projectId: project.id,
      embedder,
      title: 'api: OOMKilled',
      rootCause: 'memory leak in worker',
      metadata: { incidentId: 'inc-1' },
    })
    const recalled = await recallSimilarIncidents({
      db,
      projectId: project.id,
      embedder,
      query: 'api memory issues',
    })
    expect(recalled).toHaveLength(1)
    expect(recalled[0]!.content).toContain('api: OOMKilled')
    expect(recalled[0]!.similarity).toBeGreaterThan(0.99)
  })
})
