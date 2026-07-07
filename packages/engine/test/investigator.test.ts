import {
  createIncident,
  createOrganization,
  createProject,
  createRunbook,
  createTestDb,
  getIncidentDetail,
  searchMemory,
  type Db,
} from '@smokejumper/db'
import { createRegistry, type HostTool } from '@smokejumper/plugin-host'
import type { IncidentEvent } from '@smokejumper/plugin-sdk'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { BudgetExceededError } from '../src/budget'
import type { ModelDriver } from '../src/driver'
import { createInvestigator, type IncidentBus } from '../src/investigator'
import { embedRunbook } from '../src/runbooks'

const encryptionKey = Buffer.alloc(32, 7).toString('base64')

function collectingBus(): { bus: IncidentBus; events: IncidentEvent[] } {
  const events: IncidentEvent[] = []
  const subscribers: Array<(event: IncidentEvent) => void> = []
  return {
    events,
    bus: {
      publish(event) {
        events.push(event)
        for (const fn of subscribers) fn(event)
      },
      subscribe(fn) {
        subscribers.push(fn)
        return () => {}
      },
    },
  }
}

async function seedIncident(db: Db) {
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  const incident = await createIncident(db, {
    projectId: project.id,
    alert: {
      title: 'api: error rate spike',
      severity: 'high',
      service: 'api',
      labels: { env: 'test' },
      dedupKey: 'api-errors',
      occurredAt: new Date().toISOString(),
      raw: {},
    },
  })
  return { project, incident }
}

function echoHostTool(run?: HostTool['run']): HostTool {
  return {
    instanceId: 'inst-1',
    pluginId: 'fake-telemetry',
    name: 'fake_telemetry_echo',
    description: 'Echoes back the provided text',
    inputSchema: z.object({ text: z.string() }),
    costHint: 'cheap',
    latencyHintMs: 1,
    run:
      run ??
      (async (input) => {
        const { text } = input as { text: string }
        return { summary: `echoed ${text}`, data: { text } }
      }),
  }
}

function makeInvestigator(
  db: Db,
  bus: IncidentBus,
  tools: HostTool[],
  extra: { budgets?: { maxToolCalls?: number; maxWallMs?: number }; embedder?: () => Promise<number[]> } = {},
) {
  return createInvestigator({
    db,
    registry: createRegistry(),
    bus,
    encryptionKey,
    models: 'fake',
    budgets: extra.budgets,
    embedder: extra.embedder,
    _getTools: async () => tools,
  })
}

describe('investigate (fake driver)', () => {
  it('completes the full pipeline with evidence-backed findings and a diagnosis', async () => {
    const db = await createTestDb()
    const { incident } = await seedIncident(db)
    const { bus, events } = collectingBus()
    await makeInvestigator(db, bus, [echoHostTool()]).investigate(incident.id)

    const detail = await getIncidentDetail(db, incident.id)
    expect(detail?.incident.status).toBe('diagnosed')
    expect(detail?.investigation?.status).toBe('completed')

    expect(detail!.evidence.length).toBeGreaterThanOrEqual(1)
    const evidenceIds = new Set(detail!.evidence.map((record) => record.id))
    expect(detail!.findings).toHaveLength(3)
    const cited = detail!.findings.filter((finding) => finding.evidenceIds.length > 0)
    expect(cited.length).toBeGreaterThanOrEqual(1)
    for (const finding of detail!.findings) {
      for (const id of finding.evidenceIds) expect(evidenceIds.has(id)).toBe(true)
    }

    expect(detail!.diagnosis).toBeDefined()
    expect(detail!.diagnosis!.rootCause).toContain('api: error rate spike')
    expect(detail!.diagnosis!.evidenceChain.length).toBeGreaterThanOrEqual(1)
    for (const claim of detail!.diagnosis!.evidenceChain) {
      expect(claim.verified).toBe(true)
      for (const id of claim.evidenceIds) expect(evidenceIds.has(id)).toBe(true)
    }

    const types = events.map((event) => event.type)
    expect(types[0]).toBe('investigation.started')
    expect(types.at(-1)).toBe('diagnosis.ready')
    expect(types.filter((type) => type === 'investigation.milestone').length).toBeGreaterThanOrEqual(5)
  })

  it('contains plugin failures as evidence of absence, never a failed investigation', async () => {
    const db = await createTestDb()
    const { incident } = await seedIncident(db)
    const { bus } = collectingBus()
    const failing = echoHostTool(async () => {
      throw new Error('telemetry backend unreachable')
    })
    await makeInvestigator(db, bus, [failing]).investigate(incident.id)

    const detail = await getIncidentDetail(db, incident.id)
    expect(detail?.incident.status).toBe('diagnosed')
    expect(detail?.investigation?.status).toBe('completed')
    expect(detail!.diagnosis).toBeDefined()
    expect(detail!.evidence.length).toBeGreaterThanOrEqual(1)
    for (const record of detail!.evidence) {
      expect((record.output as { error: string }).error).toContain('telemetry backend unreachable')
    }
  })

  it('stops at the tool-call budget and still produces a diagnosis', async () => {
    const db = await createTestDb()
    const { incident } = await seedIncident(db)
    const { bus } = collectingBus()
    await makeInvestigator(db, bus, [echoHostTool()], { budgets: { maxToolCalls: 1 } }).investigate(
      incident.id,
    )

    const detail = await getIncidentDetail(db, incident.id)
    expect(detail?.investigation?.status).toBe('budget_exceeded')
    expect(detail?.incident.status).toBe('diagnosed')
    expect(detail!.evidence).toHaveLength(1)
    expect(detail!.findings).toHaveLength(1)
    expect(detail!.diagnosis).toBeDefined()
  })

  it('completes as budget_exceeded (not failed) when the budget aborts before synthesis', async () => {
    const db = await createTestDb()
    const { incident } = await seedIncident(db)
    const { bus } = collectingBus()
    const driver: ModelDriver = {
      async triage() {
        throw new BudgetExceededError('wall-clock budget exhausted during triage')
      },
      async plan() {
        return { specialists: [] }
      },
      async runSpecialist() {
        return { summary: '', evidenceIds: [] }
      },
      async synthesize() {
        return { rootCause: '', confidence: 0.5, evidenceChain: [], remediation: '', openQuestions: [] }
      },
      async draftReview() {
        return {
          summary: '',
          timeline: [],
          rootCause: '',
          contributingFactors: [],
          actionItems: [],
          evidenceRefs: [],
        }
      },
    }
    const investigator = createInvestigator({
      db,
      registry: createRegistry(),
      bus,
      encryptionKey,
      models: 'fake',
      _driver: driver,
      _getTools: async () => [],
    })
    await expect(investigator.investigate(incident.id)).rejects.toBeInstanceOf(BudgetExceededError)
    const detail = await getIncidentDetail(db, incident.id)
    expect(detail?.investigation?.status).toBe('budget_exceeded')
    expect(detail?.incident.status).toBe('investigating')
  })

  it('stores incident memory after diagnosis when an embedder is configured', async () => {
    const db = await createTestDb()
    const { project, incident } = await seedIncident(db)
    const { bus } = collectingBus()
    const embedder = async () => new Array<number>(1536).fill(0.1)
    await makeInvestigator(db, bus, [echoHostTool()], { embedder }).investigate(incident.id)

    const entries = await searchMemory(db, { projectId: project.id, embedding: await embedder(), limit: 5 })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe('incident')
    expect(entries[0]!.content).toContain('api: error rate spike')
  })

  it('writes no memory when no embedder is configured', async () => {
    const db = await createTestDb()
    const { project, incident } = await seedIncident(db)
    const { bus } = collectingBus()
    await makeInvestigator(db, bus, [echoHostTool()]).investigate(incident.id)
    const entries = await searchMemory(db, {
      projectId: project.id,
      embedding: new Array<number>(1536).fill(0.1),
      limit: 5,
    })
    expect(entries).toHaveLength(0)
  })

  it('rejects unknown incident ids', async () => {
    const db = await createTestDb()
    await seedIncident(db)
    const { bus } = collectingBus()
    const investigator = makeInvestigator(db, bus, [])
    await expect(
      investigator.investigate('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/not found/)
  })

  it('constructs with real model ids without requiring ANTHROPIC_API_KEY', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const db = await createTestDb()
    const { bus } = collectingBus()
    const investigator = createInvestigator({
      db,
      registry: createRegistry(),
      bus,
      encryptionKey,
      models: { provider: 'anthropic' as const, triage: 'claude-haiku-4-5-20251001', investigator: 'claude-sonnet-5', synthesis: 'claude-sonnet-5' },
    })
    expect(investigator.investigate).toBeTypeOf('function')
  })

  it('injects a search_runbooks tool and records its call as evidence when an embedder is configured', async () => {
    const db = await createTestDb()
    const { project, incident } = await seedIncident(db)
    const { bus } = collectingBus()
    const runbookEmbedder = async () => new Array<number>(1536).fill(0.4)
    await embedRunbook({
      db,
      embedder: runbookEmbedder,
      runbookId: 'rb-1',
      projectId: project.id,
      title: 'On-call runbook',
      content: 'Restart the affected service and check its health endpoint.',
    })
    await makeInvestigator(db, bus, [], { embedder: runbookEmbedder }).investigate(incident.id)
    const detail = await getIncidentDetail(db, incident.id)
    const runbookEvidence = detail!.evidence.filter((record) => record.toolName === 'search_runbooks')
    expect(runbookEvidence.length).toBeGreaterThan(0)
  })

  it('injects no search_runbooks tool when no embedder is configured', async () => {
    const db = await createTestDb()
    const { incident } = await seedIncident(db)
    const { bus } = collectingBus()
    await makeInvestigator(db, bus, []).investigate(incident.id)
    const detail = await getIncidentDetail(db, incident.id)
    expect(detail!.evidence.filter((record) => record.toolName === 'search_runbooks')).toHaveLength(0)
  })

  it('offline e2e: a seeded runbook produces cited search_runbooks evidence and reaches synthesis', async () => {
    const db = await createTestDb()
    const { project, incident } = await seedIncident(db)
    const { bus } = collectingBus()
    const runbookEmbedder = async () => new Array<number>(1536).fill(0.7)
    const runbook = await createRunbook(db, {
      projectId: project.id,
      title: 'Error rate spike runbook',
      sourceKind: 'paste',
      content: 'Check the load balancer health checks and recent deploys before anything else.',
    })
    await embedRunbook({
      db,
      embedder: runbookEmbedder,
      runbookId: runbook.id,
      projectId: project.id,
      title: runbook.title,
      content: runbook.content,
    })

    await makeInvestigator(db, bus, [], { embedder: runbookEmbedder }).investigate(incident.id)

    const detail = await getIncidentDetail(db, incident.id)
    expect(detail?.incident.status).toBe('diagnosed')

    const runbookEvidence = detail!.evidence.filter((record) => record.toolName === 'search_runbooks')
    expect(runbookEvidence.length).toBeGreaterThan(0)
    const cited = runbookEvidence[0]!.output as Array<{ title: string }>
    expect(cited[0]!.title).toBe('Error rate spike runbook')

    expect(detail!.diagnosis!.rootCause).toContain('Error rate spike runbook')
  })
})
