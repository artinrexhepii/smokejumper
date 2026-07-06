import { describe, expect, it } from 'vitest'
import type { NormalizedAlert } from '@smokejumper/plugin-sdk'
import {
  approveReview,
  createIncident,
  createOrganization,
  createProject,
  createReview,
  createTestDb,
  createUser,
  getReviewByIncident,
  updateReview,
  upsertGenerated,
  type Db,
  type Incident,
  type ReviewBody,
} from '../src/index.ts'

function makeAlert(): NormalizedAlert {
  return {
    title: 'api: OOMKilled',
    severity: 'critical',
    service: 'api',
    labels: { env: 'prod' },
    dedupKey: 'api-oom',
    occurredAt: new Date().toISOString(),
    raw: { source: 'test' },
  }
}

function makeBody(overrides: Partial<ReviewBody> = {}): ReviewBody {
  return {
    summary: 'api was down for 12 minutes due to an OOM kill',
    timeline: [{ at: '10:15', text: 'api container OOM-killed' }],
    rootCause: 'memory leak in image resize worker',
    contributingFactors: ['no memory-usage alerting'],
    actionItems: ['add a memory-usage alert'],
    evidenceRefs: [],
    ...overrides,
  }
}

async function setup(): Promise<{ db: Db; incident: Incident; userId: string }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  const incident = await createIncident(db, { projectId: project.id, alert: makeAlert() })
  const user = await createUser(db, { email: 'reviewer@example.com', password: 'smokejumper', name: 'Reviewer' })
  return { db, incident, userId: user.id }
}

describe('createReview / getReviewByIncident', () => {
  it('creates a draft review with the generated body and no edits', async () => {
    const { db, incident } = await setup()
    const generated = makeBody()
    const review = await createReview(db, { incidentId: incident.id, generated })
    expect(review.status).toBe('draft')
    expect(review.generated).toEqual(generated)
    expect(review.edited).toBeNull()
    expect(review.approvedBy).toBeNull()
    expect(review.approvedAt).toBeNull()
    expect(await getReviewByIncident(db, incident.id)).toMatchObject({ id: review.id })
  })

  it('returns undefined for an incident with no review', async () => {
    const { db, incident } = await setup()
    expect(await getReviewByIncident(db, incident.id)).toBeUndefined()
  })

  it('enforces one review per incident', async () => {
    const { db, incident } = await setup()
    await createReview(db, { incidentId: incident.id, generated: makeBody() })
    await expect(createReview(db, { incidentId: incident.id, generated: makeBody() })).rejects.toThrow()
  })
})

describe('updateReview', () => {
  it('sets the edited body and leaves status and generated untouched', async () => {
    const { db, incident } = await setup()
    const generated = makeBody()
    await createReview(db, { incidentId: incident.id, generated })
    const edited = makeBody({ summary: 'human-tightened summary' })
    await updateReview(db, incident.id, edited)
    const review = await getReviewByIncident(db, incident.id)
    expect(review?.status).toBe('draft')
    expect(review?.generated).toEqual(generated)
    expect(review?.edited).toEqual(edited)
  })
})

describe('approveReview', () => {
  it('sets status to approved with the approver and a timestamp', async () => {
    const { db, incident, userId } = await setup()
    await createReview(db, { incidentId: incident.id, generated: makeBody() })
    await approveReview(db, incident.id, userId)
    const review = await getReviewByIncident(db, incident.id)
    expect(review?.status).toBe('approved')
    expect(review?.approvedBy).toBe(userId)
    expect(review?.approvedAt).toBeInstanceOf(Date)
  })
})

describe('upsertGenerated', () => {
  it('creates a review when none exists', async () => {
    const { db, incident } = await setup()
    const generated = makeBody()
    const review = await upsertGenerated(db, incident.id, generated)
    expect(review.generated).toEqual(generated)
  })

  it('replaces only the generated field of an existing, edited review', async () => {
    const { db, incident } = await setup()
    await createReview(db, { incidentId: incident.id, generated: makeBody() })
    await updateReview(db, incident.id, makeBody({ summary: 'human edit' }))
    const regenerated = makeBody({ summary: 'regenerated summary' })
    const review = await upsertGenerated(db, incident.id, regenerated)
    expect(review.generated).toEqual(regenerated)
    expect(review.edited?.summary).toBe('human edit')
  })
})
