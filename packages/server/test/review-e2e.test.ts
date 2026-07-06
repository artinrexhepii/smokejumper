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
  getIncident,
  getReviewByIncident,
  type Db,
} from '@smokejumper/db'
import { createFakeDriver } from '@smokejumper/engine'
import type { NormalizedAlert } from '@smokejumper/plugin-sdk'
import { createBus, type IncidentBus } from '../src/bus.ts'
import { createIncidentManager } from '../src/incident-manager.ts'
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

describe('post-incident review offline e2e', () => {
  it('drafts a review on resolve and exports it as valid markdown', async () => {
    const db: Db = await createTestDb()
    const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
    const user = await createUser(db, { email: 'oncall@example.com', password: 'smokejumper', name: 'On Call' })
    await addMember(db, { orgId: org.id, userId: user.id, role: 'member' })
    const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
    const bus: IncidentBus = createBus()

    const incident = await createIncident(db, { projectId: project.id, alert: makeAlert() })
    const investigation = await createInvestigation(db, {
      incidentId: incident.id,
      budget: { maxToolCalls: 25, maxWallMs: 240_000 },
    })
    const evidence = await appendEvidence(db, {
      investigationId: investigation.id,
      toolName: 'docker_container_logs',
      input: { container: 'api' },
      output: { lines: ['Out of memory: kill process'] },
      summary: 'api container was OOM-killed',
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

    const driver = createFakeDriver()
    const incidentManager = createIncidentManager({ db, bus, driver })
    await incidentManager.resolve(incident.id)

    expect((await getIncident(db, incident.id))?.status).toBe('resolved')
    const review = await getReviewByIncident(db, incident.id)
    expect(review?.status).toBe('draft')
    expect(review?.generated.rootCause).toBe('memory leak in image resize worker')
    expect(review?.generated.actionItems).toEqual(['roll back deploy 4f2c1a'])
    expect(review?.generated.evidenceRefs).toEqual([evidence.id])

    const { token } = await createSession(db, user.id)
    const app = await buildServer({ db, encryptionKey: TEST_KEY, bus, reviewDriver: driver })
    const res = await app.inject({
      method: 'GET',
      url: `/api/incidents/${incident.id}/review/export`,
      cookies: { sj_session: token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/markdown')
    const markdown = res.body
    expect(markdown).toContain('# Post-incident review: api: OOMKilled')
    expect(markdown).toContain('memory leak in image resize worker')
    expect(markdown).toContain('roll back deploy 4f2c1a')
    expect(markdown).toContain(evidence.id)
    for (const heading of [
      '## Summary',
      '## Timeline',
      '## Root cause',
      '## Contributing factors',
      '## Action items',
      '## Cited evidence',
    ]) {
      expect(markdown).toContain(heading)
    }
  })
})
