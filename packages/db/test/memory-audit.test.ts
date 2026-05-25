import { describe, expect, it } from 'vitest'
import * as auditModule from '../src/audit.ts'
import {
  addMemoryEntry,
  appendAudit,
  createOrganization,
  createProject,
  createTestDb,
  listAudit,
  searchMemory,
  type Db,
} from '../src/index.ts'

function unitVector(index: number): number[] {
  const v = new Array<number>(1536).fill(0)
  v[index] = 1
  return v
}

async function setup(): Promise<{ db: Db; orgId: string; projectId: string }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  return { db, orgId: org.id, projectId: project.id }
}

describe('memory', () => {
  it('ranks entries by cosine similarity', async () => {
    const { db, projectId } = await setup()
    await addMemoryEntry(db, {
      projectId,
      kind: 'incident',
      content: 'oom in api',
      embedding: unitVector(0),
      metadata: { incidentId: 'a' },
    })
    await addMemoryEntry(db, {
      projectId,
      kind: 'runbook',
      content: 'db failover runbook',
      embedding: unitVector(1),
      metadata: {},
    })
    const results = await searchMemory(db, { projectId, embedding: unitVector(0), limit: 2 })
    expect(results).toHaveLength(2)
    expect(results[0]!.content).toBe('oom in api')
    expect(results[0]!.similarity).toBeCloseTo(1, 5)
    expect(results[1]!.similarity).toBeCloseTo(0, 5)
  })

  it('scopes search to the project', async () => {
    const { db, orgId, projectId } = await setup()
    const other = await createProject(db, { orgId, name: 'Other', slug: 'other' })
    await addMemoryEntry(db, {
      projectId: other.id,
      kind: 'incident',
      content: 'other project memory',
      embedding: unitVector(0),
      metadata: {},
    })
    expect(await searchMemory(db, { projectId, embedding: unitVector(0), limit: 5 })).toEqual([])
  })
})

describe('audit log', () => {
  it('appends entries and lists them newest first', async () => {
    const { db, orgId } = await setup()
    await appendAudit(db, {
      orgId,
      actorType: 'system',
      actorId: 'seed',
      action: 'project.created',
      subjectType: 'project',
      subjectId: 'p1',
      detail: {},
    })
    await appendAudit(db, {
      orgId,
      actorType: 'user',
      actorId: 'u1',
      action: 'diagnosis.verdict',
      subjectType: 'diagnosis',
      subjectId: 'd1',
      detail: { verdict: 'confirmed' },
    })
    const entries = await listAudit(db, { orgId })
    expect(entries).toHaveLength(2)
    expect(entries[0]!.action).toBe('diagnosis.verdict')
    expect(entries[1]!.action).toBe('project.created')
    expect(await listAudit(db, { orgId, limit: 1 })).toHaveLength(1)
  })

  it('exposes only append and list', () => {
    expect(Object.keys(auditModule).sort()).toEqual(['appendAudit', 'listAudit'])
  })
})
