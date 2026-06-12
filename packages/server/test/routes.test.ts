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
  getDiagnosis,
  type Db,
  type Diagnosis,
  type Incident,
  type Investigation,
} from '@smokejumper/db'
import type { NormalizedAlert } from '@smokejumper/plugin-sdk'
import type { FastifyInstance } from 'fastify'
import { createBus } from '../src/bus.ts'
import { buildServer } from '../src/server.ts'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

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

interface Ctx {
  db: Db
  app: FastifyInstance
  orgId: string
  otherOrgId: string
  projectId: string
  otherProjectId: string
  cookies: { sj_session: string }
}

async function setup(): Promise<Ctx> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const otherOrg = await createOrganization(db, { name: 'Rival', slug: 'rival' })
  const user = await createUser(db, {
    email: 'admin@example.com',
    password: 'smokejumper',
    name: 'Admin',
  })
  await addMember(db, { orgId: org.id, userId: user.id, role: 'owner' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  const otherProject = await createProject(db, { orgId: otherOrg.id, name: 'Secret', slug: 'secret' })
  const { token } = await createSession(db, user.id)
  const app = await buildServer({ db, encryptionKey: TEST_KEY, bus: createBus() })
  return {
    db,
    app,
    orgId: org.id,
    otherOrgId: otherOrg.id,
    projectId: project.id,
    otherProjectId: otherProject.id,
    cookies: { sj_session: token },
  }
}

async function makeDiagnosed(ctx: Ctx): Promise<{
  incident: Incident
  investigation: Investigation
  diagnosis: Diagnosis
}> {
  const incident = await createIncident(ctx.db, { projectId: ctx.projectId, alert: makeAlert() })
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
  const diagnosis = await createDiagnosis(ctx.db, {
    investigationId: investigation.id,
    rootCause: 'memory leak',
    confidence: 0.8,
    evidenceChain: [{ claim: 'api OOM-killed', evidenceIds: [evidence.id], verified: true }],
    remediation: 'roll back',
    openQuestions: [],
  })
  return { incident, investigation, diagnosis }
}

describe('data routes', () => {
  it('lists projects for orgs the caller belongs to', async () => {
    const ctx = await setup()
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/orgs/${ctx.orgId}/projects`,
      cookies: ctx.cookies,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((p: { id: string }) => p.id)).toEqual([ctx.projectId])
    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: `/api/orgs/${ctx.otherOrgId}/projects`,
      cookies: ctx.cookies,
    })
    expect(forbidden.statusCode).toBe(403)
  })

  it('lists incidents for a project with org checks', async () => {
    const ctx = await setup()
    const { incident } = await makeDiagnosed(ctx)
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${ctx.projectId}/incidents`,
      cookies: ctx.cookies,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((i: { id: string }) => i.id)).toEqual([incident.id])
    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${ctx.otherProjectId}/incidents`,
      cookies: ctx.cookies,
    })
    expect(forbidden.statusCode).toBe(403)
    const missing = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${randomUUID()}/incidents`,
      cookies: ctx.cookies,
    })
    expect(missing.statusCode).toBe(404)
  })

  it('returns the full incident detail', async () => {
    const ctx = await setup()
    const { incident, investigation, diagnosis } = await makeDiagnosed(ctx)
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/incidents/${incident.id}`,
      cookies: ctx.cookies,
    })
    expect(res.statusCode).toBe(200)
    const detail = res.json()
    expect(detail.incident.id).toBe(incident.id)
    expect(detail.investigation.id).toBe(investigation.id)
    expect(detail.findings).toHaveLength(1)
    expect(detail.evidence).toHaveLength(1)
    expect(detail.diagnosis.id).toBe(diagnosis.id)
  })

  it('404s unknown incidents and 403s cross-org incidents', async () => {
    const ctx = await setup()
    const missing = await ctx.app.inject({
      method: 'GET',
      url: `/api/incidents/${randomUUID()}`,
      cookies: ctx.cookies,
    })
    expect(missing.statusCode).toBe(404)
    const foreign = await createIncident(ctx.db, {
      projectId: ctx.otherProjectId,
      alert: makeAlert(),
    })
    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: `/api/incidents/${foreign.id}`,
      cookies: ctx.cookies,
    })
    expect(forbidden.statusCode).toBe(403)
  })

  it('records a verdict and writes an audit entry', async () => {
    const ctx = await setup()
    const { diagnosis } = await makeDiagnosed(ctx)
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/diagnoses/${diagnosis.id}/verdict`,
      cookies: ctx.cookies,
      payload: { verdict: 'confirmed', note: 'spot on' },
    })
    expect(res.statusCode).toBe(204)
    const updated = await getDiagnosis(ctx.db, diagnosis.id)
    expect(updated?.humanVerdict).toBe('confirmed')
    expect(updated?.humanNote).toBe('spot on')

    const audit = await ctx.app.inject({
      method: 'GET',
      url: `/api/orgs/${ctx.orgId}/audit`,
      cookies: ctx.cookies,
    })
    expect(audit.statusCode).toBe(200)
    expect(audit.json()[0]).toMatchObject({
      action: 'diagnosis.verdict',
      actorType: 'user',
      subjectType: 'diagnosis',
      subjectId: diagnosis.id,
      detail: { verdict: 'confirmed', note: 'spot on' },
    })
  })

  it('rejects bad verdicts and unknown diagnoses', async () => {
    const ctx = await setup()
    const { diagnosis } = await makeDiagnosed(ctx)
    const bad = await ctx.app.inject({
      method: 'POST',
      url: `/api/diagnoses/${diagnosis.id}/verdict`,
      cookies: ctx.cookies,
      payload: { verdict: 'maybe' },
    })
    expect(bad.statusCode).toBe(400)
    const missing = await ctx.app.inject({
      method: 'POST',
      url: `/api/diagnoses/${randomUUID()}/verdict`,
      cookies: ctx.cookies,
      payload: { verdict: 'confirmed' },
    })
    expect(missing.statusCode).toBe(404)
  })

  it('403s the verdict endpoint for cross-org incidents', async () => {
    const ctx = await setup()
    const foreignIncident = await createIncident(ctx.db, {
      projectId: ctx.otherProjectId,
      alert: makeAlert(),
    })
    const foreignInvestigation = await createInvestigation(ctx.db, {
      incidentId: foreignIncident.id,
      budget: { maxToolCalls: 25, maxWallMs: 240_000 },
    })
    const foreignEvidence = await appendEvidence(ctx.db, {
      investigationId: foreignInvestigation.id,
      toolName: 'http_check',
      input: { url: 'http://api/health' },
      output: { status: 503 },
      summary: 'health check failing',
    })
    await addFinding(ctx.db, {
      investigationId: foreignInvestigation.id,
      specialist: 'log-analyst',
      summary: 'api down',
      evidenceIds: [foreignEvidence.id],
    })
    const foreignDiagnosis = await createDiagnosis(ctx.db, {
      investigationId: foreignInvestigation.id,
      rootCause: 'memory leak',
      confidence: 0.8,
      evidenceChain: [{ claim: 'api OOM-killed', evidenceIds: [foreignEvidence.id], verified: true }],
      remediation: 'roll back',
      openQuestions: [],
    })
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/diagnoses/${foreignDiagnosis.id}/verdict`,
      cookies: ctx.cookies,
      payload: { verdict: 'confirmed', note: 'unauthorized access' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('403s the audit log for non-members', async () => {
    const ctx = await setup()
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/orgs/${ctx.otherOrgId}/audit`,
      cookies: ctx.cookies,
    })
    expect(res.statusCode).toBe(403)
  })
})
