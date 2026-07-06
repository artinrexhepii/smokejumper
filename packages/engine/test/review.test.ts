import { describe, expect, it } from 'vitest'
import type { NormalizedAlert } from '@smokejumper/plugin-sdk'
import {
  addFinding,
  appendEvidence,
  createDiagnosis,
  createIncident,
  createInvestigation,
  createOrganization,
  createProject,
  createTestDb,
  type Db,
  type Incident,
} from '@smokejumper/db'
import { createFakeDriver } from '../src/fake-driver'
import type { ModelDriver, ReviewResult } from '../src/driver'
import { draftIncidentReview } from '../src/review'

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

async function setup(): Promise<{ db: Db; incident: Incident }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  const incident = await createIncident(db, { projectId: project.id, alert: makeAlert() })
  return { db, incident }
}

describe('draftIncidentReview', () => {
  it('throws for an unknown incident', async () => {
    const { db } = await setup()
    await expect(
      draftIncidentReview({
        db,
        incidentId: '00000000-0000-0000-0000-000000000000',
        driver: createFakeDriver(),
      }),
    ).rejects.toThrow()
  })

  it('drafts a review from the investigation record using the fake driver', async () => {
    const { db, incident } = await setup()
    const investigation = await createInvestigation(db, {
      incidentId: incident.id,
      budget: { maxToolCalls: 25, maxWallMs: 240_000 },
    })
    const evidence = await appendEvidence(db, {
      investigationId: investigation.id,
      toolName: 'docker_container_logs',
      input: { container: 'api' },
      output: { lines: ['OOM'] },
      summary: 'api container OOM-killed',
    })
    await addFinding(db, {
      investigationId: investigation.id,
      specialist: 'log-analyst',
      summary: 'api down since 10:15',
      evidenceIds: [evidence.id],
    })
    await createDiagnosis(db, {
      investigationId: investigation.id,
      rootCause: 'memory leak in image resize worker',
      confidence: 0.82,
      evidenceChain: [{ claim: 'api OOM-killed', evidenceIds: [evidence.id], verified: true }],
      remediation: 'roll back deploy 4f2c1a',
      openQuestions: [],
    })
    const body = await draftIncidentReview({ db, incidentId: incident.id, driver: createFakeDriver() })
    expect(body.rootCause).toBe('memory leak in image resize worker')
    expect(body.timeline).toEqual([{ at: 'step-1', text: 'docker_container_logs: api container OOM-killed' }])
    expect(body.actionItems).toEqual(['roll back deploy 4f2c1a'])
    expect(body.evidenceRefs).toEqual([evidence.id])
  })

  it('dedupes and drops evidence ids the driver invents that are not in the investigation', async () => {
    const { db, incident } = await setup()
    const investigation = await createInvestigation(db, {
      incidentId: incident.id,
      budget: { maxToolCalls: 25, maxWallMs: 240_000 },
    })
    const evidence = await appendEvidence(db, {
      investigationId: investigation.id,
      toolName: 'http_check',
      input: { url: 'http://api/health' },
      output: { status: 503 },
      summary: 'health check failing',
    })
    const fabricatingDriver: ModelDriver = {
      ...createFakeDriver(),
      async draftReview(): Promise<ReviewResult> {
        return {
          summary: 'fabricated',
          timeline: [],
          rootCause: 'unknown',
          contributingFactors: [],
          actionItems: [],
          evidenceRefs: [evidence.id, evidence.id, 'ghost-evidence-id'],
        }
      },
    }
    const body = await draftIncidentReview({ db, incidentId: incident.id, driver: fabricatingDriver })
    expect(body.evidenceRefs).toEqual([evidence.id])
  })

  it('produces an undiagnosed review body when no investigation has run yet', async () => {
    const { db, incident } = await setup()
    const body = await draftIncidentReview({ db, incidentId: incident.id, driver: createFakeDriver() })
    expect(body.rootCause).toContain('No diagnosis')
    expect(body.evidenceRefs).toEqual([])
    expect(body.timeline).toEqual([])
  })
})
