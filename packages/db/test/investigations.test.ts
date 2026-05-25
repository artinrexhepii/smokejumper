import { describe, expect, it } from 'vitest'
import type { NormalizedAlert } from '@smokejumper/plugin-sdk'
import {
  addFinding,
  appendEvidence,
  canonicalJson,
  completeInvestigation,
  createDiagnosis,
  createIncident,
  createInvestigation,
  createOrganization,
  createProject,
  createTestDb,
  getDiagnosis,
  getIncidentDetail,
  getInvestigation,
  listEvidence,
  setDiagnosisVerdict,
  sha256hex,
  type Db,
  type Incident,
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

async function setup(): Promise<{ db: Db; incident: Incident }> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  const incident = await createIncident(db, { projectId: project.id, alert: makeAlert() })
  return { db, incident }
}

const BUDGET = { maxToolCalls: 25, maxWallMs: 240_000 }

describe('canonicalJson', () => {
  it('sorts object keys recursively and leaves arrays ordered', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
    expect(canonicalJson({ list: [3, { z: 1, y: 2 }] })).toBe('{"list":[3,{"y":2,"z":1}]}')
    expect(canonicalJson('plain')).toBe('"plain"')
    expect(canonicalJson(null)).toBe('null')
  })
})

describe('investigations', () => {
  it('creates and completes investigations', async () => {
    const { db, incident } = await setup()
    const investigation = await createInvestigation(db, { incidentId: incident.id, budget: BUDGET })
    expect(investigation.status).toBe('running')
    expect(investigation.budget).toEqual(BUDGET)
    expect(investigation.completedAt).toBeNull()
    await completeInvestigation(db, investigation.id, {
      status: 'budget_exceeded',
      stats: { toolCalls: 25 },
    })
    const completed = await getInvestigation(db, investigation.id)
    expect(completed?.status).toBe('budget_exceeded')
    expect(completed?.stats).toEqual({ toolCalls: 25 })
    expect(completed?.completedAt).toBeInstanceOf(Date)
  })
})

describe('evidence hash chain', () => {
  it('appends records with sequential seq and a verifiable chain', async () => {
    const { db, incident } = await setup()
    const investigation = await createInvestigation(db, { incidentId: incident.id, budget: BUDGET })
    const first = await appendEvidence(db, {
      investigationId: investigation.id,
      toolName: 'docker_container_logs',
      input: { container: 'api', tail: 100 },
      output: { lines: ['Out of memory: kill process'] },
      summary: 'api container was OOM-killed',
    })
    expect(first.seq).toBe(1)
    expect(first.prevHash).toBe('genesis')
    const second = await appendEvidence(db, {
      investigationId: investigation.id,
      toolName: 'http_check',
      input: { url: 'http://api/health' },
      output: { status: 503, latencyMs: 12 },
      summary: 'health check failing',
    })
    expect(second.seq).toBe(2)
    expect(second.prevHash).toBe(first.hash)

    const records = await listEvidence(db, investigation.id)
    expect(records.map((r) => r.seq)).toEqual([1, 2])
    let prev = 'genesis'
    for (const record of records) {
      expect(record.prevHash).toBe(prev)
      const expected = sha256hex(
        prev +
          canonicalJson({
            investigationId: record.investigationId,
            seq: record.seq,
            toolName: record.toolName,
            input: record.input,
            output: record.output,
            summary: record.summary,
          }),
      )
      expect(record.hash).toBe(expected)
      prev = record.hash
    }
  })
})

describe('findings and diagnoses', () => {
  it('stores findings with evidence pointers', async () => {
    const { db, incident } = await setup()
    const investigation = await createInvestigation(db, { incidentId: incident.id, budget: BUDGET })
    const evidence = await appendEvidence(db, {
      investigationId: investigation.id,
      toolName: 'http_check',
      input: { url: 'http://api/health' },
      output: { status: 503 },
      summary: 'health check failing',
    })
    const finding = await addFinding(db, {
      investigationId: investigation.id,
      specialist: 'log-analyst',
      summary: 'api is down since 10:15',
      evidenceIds: [evidence.id],
    })
    expect(finding.evidenceIds).toEqual([evidence.id])
  })

  it('auto-increments diagnosis versions per investigation', async () => {
    const { db, incident } = await setup()
    const investigation = await createInvestigation(db, { incidentId: incident.id, budget: BUDGET })
    const input = {
      investigationId: investigation.id,
      rootCause: 'memory leak in image resize worker',
      confidence: 0.82,
      evidenceChain: [{ claim: 'api OOM-killed', evidenceIds: [], verified: false }],
      remediation: 'roll back deploy 4f2c1a',
      openQuestions: ['why did the leak start today?'],
    }
    const v1 = await createDiagnosis(db, input)
    const v2 = await createDiagnosis(db, input)
    expect(v1.version).toBe(1)
    expect(v2.version).toBe(2)
    expect(v1.humanVerdict).toBeNull()
  })

  it('records human verdicts', async () => {
    const { db, incident } = await setup()
    const investigation = await createInvestigation(db, { incidentId: incident.id, budget: BUDGET })
    const diagnosis = await createDiagnosis(db, {
      investigationId: investigation.id,
      rootCause: 'memory leak',
      confidence: 0.8,
      evidenceChain: [],
      remediation: 'restart',
      openQuestions: [],
    })
    await setDiagnosisVerdict(db, diagnosis.id, { verdict: 'partial', note: 'leak yes, wrong service' })
    const updated = await getDiagnosis(db, diagnosis.id)
    expect(updated?.humanVerdict).toBe('partial')
    expect(updated?.humanNote).toBe('leak yes, wrong service')
  })
})

describe('getIncidentDetail', () => {
  it('returns undefined for missing incidents', async () => {
    const { db } = await setup()
    expect(await getIncidentDetail(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined()
  })

  it('returns the incident with empty collections before an investigation exists', async () => {
    const { db, incident } = await setup()
    const detail = await getIncidentDetail(db, incident.id)
    expect(detail?.incident.id).toBe(incident.id)
    expect(detail?.investigation).toBeUndefined()
    expect(detail?.findings).toEqual([])
    expect(detail?.evidence).toEqual([])
    expect(detail?.diagnosis).toBeUndefined()
  })

  it('returns the full investigation view with the latest diagnosis', async () => {
    const { db, incident } = await setup()
    const investigation = await createInvestigation(db, { incidentId: incident.id, budget: BUDGET })
    const evidence = await appendEvidence(db, {
      investigationId: investigation.id,
      toolName: 'http_check',
      input: { url: 'http://api/health' },
      output: { status: 503 },
      summary: 'health check failing',
    })
    await addFinding(db, {
      investigationId: investigation.id,
      specialist: 'log-analyst',
      summary: 'api down',
      evidenceIds: [evidence.id],
    })
    const diagnosisInput = {
      investigationId: investigation.id,
      rootCause: 'memory leak',
      confidence: 0.8,
      evidenceChain: [],
      remediation: 'restart',
      openQuestions: [],
    }
    await createDiagnosis(db, diagnosisInput)
    const latest = await createDiagnosis(db, diagnosisInput)
    const detail = await getIncidentDetail(db, incident.id)
    expect(detail?.investigation?.id).toBe(investigation.id)
    expect(detail?.findings).toHaveLength(1)
    expect(detail?.evidence).toHaveLength(1)
    expect(detail?.diagnosis?.id).toBe(latest.id)
    expect(detail?.diagnosis?.version).toBe(2)
  })
})
