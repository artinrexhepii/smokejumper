import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  addFinding,
  addMember,
  appendEvidence,
  createDiagnosis,
  createIncident,
  createInvestigation,
  createOrganization,
  createProject,
  createSession,
  createTestDb,
  createUser,
  listAudit,
  type Db,
  type Incident,
} from '@smokejumper/db'
import { createFakeDriver } from '@smokejumper/engine'
import type { FastifyInstance } from 'fastify'
import { createBus } from '../src/bus.ts'
import { buildServer } from '../src/server.ts'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

interface Ctx {
  db: Db
  app: FastifyInstance
  orgId: string
  otherProjectId: string
  cookies: { sj_session: string }
}

async function setup(): Promise<Ctx> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const otherOrg = await createOrganization(db, { name: 'Rival', slug: 'rival' })
  const user = await createUser(db, { email: 'admin@example.com', password: 'smokejumper', name: 'Admin' })
  await addMember(db, { orgId: org.id, userId: user.id, role: 'member' })
  const otherProject = await createProject(db, { orgId: otherOrg.id, name: 'Secret', slug: 'secret' })
  const { token } = await createSession(db, user.id)
  const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus(), reviewDriver: createFakeDriver() })
  return { db, app, orgId: org.id, otherProjectId: otherProject.id, cookies: { sj_session: token } }
}

async function makeDiagnosedIncident(ctx: Ctx, slug: string): Promise<Incident> {
  const project = await createProject(ctx.db, { orgId: ctx.orgId, name: slug, slug })
  const incident = await createIncident(ctx.db, {
    projectId: project.id,
    alert: {
      title: 'api: OOMKilled',
      severity: 'critical',
      service: 'api',
      labels: {},
      dedupKey: `api-oom-${slug}`,
      occurredAt: new Date().toISOString(),
      raw: {},
    },
  })
  const investigation = await createInvestigation(ctx.db, {
    incidentId: incident.id,
    budget: { maxToolCalls: 25, maxWallMs: 240_000 },
  })
  const evidence = await appendEvidence(ctx.db, {
    investigationId: investigation.id,
    toolName: 'http_check',
    input: { url: 'http://api/health' },
    output: { status: 503 },
    summary: 'health check failing',
  })
  await addFinding(ctx.db, {
    investigationId: investigation.id,
    specialist: 'log-analyst',
    summary: 'api down',
    evidenceIds: [evidence.id],
  })
  await createDiagnosis(ctx.db, {
    investigationId: investigation.id,
    rootCause: 'memory leak',
    confidence: 0.8,
    evidenceChain: [{ claim: 'api OOM-killed', evidenceIds: [evidence.id], verified: true }],
    remediation: 'roll back',
    openQuestions: [],
  })
  return incident
}

describe('review routes', () => {
  it('404s GET when no review has been generated yet', async () => {
    const ctx = await setup()
    const incident = await makeDiagnosedIncident(ctx, 'd1')
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/incidents/${incident.id}/review`,
      cookies: ctx.cookies,
    })
    expect(res.statusCode).toBe(404)
  })

  it('generates a draft review and audits review.generate', async () => {
    const ctx = await setup()
    const incident = await makeDiagnosedIncident(ctx, 'd2')
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/incidents/${incident.id}/review`,
      cookies: ctx.cookies,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.status).toBe('draft')
    expect(body.generated.rootCause).toBe('memory leak')
    const audit = await listAudit(ctx.db, { orgId: ctx.orgId })
    expect(audit[0]).toMatchObject({ action: 'review.generate', subjectType: 'incident_review' })

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/incidents/${incident.id}/review`,
      cookies: ctx.cookies,
    })
    expect(get.statusCode).toBe(200)
    expect(get.json().id).toBe(body.id)
  })

  it('edits the review, filtering unknown evidence refs, and audits review.edit', async () => {
    const ctx = await setup()
    const incident = await makeDiagnosedIncident(ctx, 'd3')
    const generated = await ctx.app.inject({
      method: 'POST',
      url: `/api/incidents/${incident.id}/review`,
      cookies: ctx.cookies,
    })
    const knownId = generated.json().generated.evidenceRefs[0]
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/incidents/${incident.id}/review`,
      cookies: ctx.cookies,
      payload: {
        edited: {
          summary: 'human-tightened summary',
          timeline: [],
          rootCause: 'confirmed: memory leak',
          contributingFactors: [],
          actionItems: ['add a memory alert'],
          evidenceRefs: [knownId, 'ghost-id'],
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().edited.summary).toBe('human-tightened summary')
    expect(res.json().edited.evidenceRefs).toEqual([knownId])
    const audit = await listAudit(ctx.db, { orgId: ctx.orgId })
    expect(audit[0]).toMatchObject({ action: 'review.edit' })
  })

  it('approves the review and audits review.approve', async () => {
    const ctx = await setup()
    const incident = await makeDiagnosedIncident(ctx, 'd4')
    await ctx.app.inject({ method: 'POST', url: `/api/incidents/${incident.id}/review`, cookies: ctx.cookies })
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/incidents/${incident.id}/review/approve`,
      cookies: ctx.cookies,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('approved')
    expect(res.json().approvedBy).toBeDefined()
    const audit = await listAudit(ctx.db, { orgId: ctx.orgId })
    expect(audit[0]).toMatchObject({ action: 'review.approve' })
  })

  it('exports markdown that renders the edited body over the generated one', async () => {
    const ctx = await setup()
    const incident = await makeDiagnosedIncident(ctx, 'd5')
    await ctx.app.inject({ method: 'POST', url: `/api/incidents/${incident.id}/review`, cookies: ctx.cookies })
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/incidents/${incident.id}/review`,
      cookies: ctx.cookies,
      payload: {
        edited: {
          summary: 'the human summary',
          timeline: [{ at: '10:15', text: 'api OOM-killed' }],
          rootCause: 'memory leak, confirmed',
          contributingFactors: ['no alerting'],
          actionItems: ['add an alert'],
          evidenceRefs: [],
        },
      },
    })
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/incidents/${incident.id}/review/export`,
      cookies: ctx.cookies,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/markdown')
    expect(res.body).toContain('# Post-incident review: api: OOMKilled')
    expect(res.body).toContain('the human summary')
    expect(res.body).not.toContain('Fake review:')
  })

  it('404s an unknown incident and 403s a cross-org incident on every route', async () => {
    const ctx = await setup()
    const foreign = await createIncident(ctx.db, {
      projectId: ctx.otherProjectId,
      alert: {
        title: 'foreign',
        severity: 'high',
        service: 'svc',
        labels: {},
        dedupKey: 'foreign',
        occurredAt: new Date().toISOString(),
        raw: {},
      },
    })
    const missing = await ctx.app.inject({
      method: 'GET',
      url: `/api/incidents/${randomUUID()}/review`,
      cookies: ctx.cookies,
    })
    expect(missing.statusCode).toBe(404)
    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: `/api/incidents/${foreign.id}/review`,
      cookies: ctx.cookies,
    })
    expect(forbidden.statusCode).toBe(403)
    const forbiddenPost = await ctx.app.inject({
      method: 'POST',
      url: `/api/incidents/${foreign.id}/review`,
      cookies: ctx.cookies,
    })
    expect(forbiddenPost.statusCode).toBe(403)
  })
})
