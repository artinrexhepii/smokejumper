import {
  addFinding,
  appendEvidence,
  completeInvestigation,
  createDiagnosis,
  createInvestigation,
  getIncidentDetail,
  listEvidence,
  updateIncidentStatus,
  type Db,
} from '@smokejumper/db'
import { getInstanceTools, type HostTool, type PluginRegistry } from '@smokejumper/plugin-host'
import type { IncidentEvent } from '@smokejumper/plugin-sdk'
import { createAnthropicDriver } from './anthropic-driver'
import { BudgetExceededError, createBudget } from './budget'
import { resolveEngineConfig, type EngineBudgets, type EngineModels } from './config'
import type { DriverTool, ModelDriver } from './driver'
import { filterEvidenceChain } from './evidence-filter'
import { createFakeDriver } from './fake-driver'
import { recallSimilarIncidents, storeIncidentMemory, type Embedder } from './memory'
import { validatePlan } from './plan-validation'
import { bindTools } from './recorder'

export interface IncidentBus {
  publish(event: IncidentEvent): void
  subscribe(fn: (event: IncidentEvent) => void): () => void
}

export interface Investigator {
  investigate(incidentId: string): Promise<void>
}

export interface CreateInvestigatorOptions {
  db: Db
  registry: PluginRegistry
  bus: IncidentBus
  encryptionKey: string
  models?: EngineModels | 'fake'
  budgets?: Partial<EngineBudgets>
  embedder?: Embedder
  _driver?: ModelDriver
  _getTools?: (projectId: string) => Promise<HostTool[]>
}

export function createInvestigator(opts: CreateInvestigatorOptions): Investigator {
  const config = resolveEngineConfig({ models: opts.models, budgets: opts.budgets })
  const driver =
    opts._driver ?? (config.models === 'fake' ? createFakeDriver() : createAnthropicDriver(config.models))
  const getTools =
    opts._getTools ??
    ((projectId: string) =>
      getInstanceTools({ db: opts.db, encryptionKey: opts.encryptionKey, registry: opts.registry, projectId }))

  return {
    async investigate(incidentId) {
      const detail = await getIncidentDetail(opts.db, incidentId)
      if (!detail) throw new Error(`incident ${incidentId} not found`)
      const incident = detail.incident
      const projectId = incident.projectId

      const publish = (type: IncidentEvent['type'], payload: Record<string, unknown>) =>
        opts.bus.publish({ type, incidentId, projectId, occurredAt: new Date().toISOString(), payload })

      await updateIncidentStatus(opts.db, incidentId, 'investigating')
      const investigation = await createInvestigation(opts.db, { incidentId, budget: config.budgets })
      publish('investigation.started', { investigationId: investigation.id, budget: config.budgets })

      const budget = createBudget(config.budgets)
      try {
        const triage = await driver.triage(
          {
            title: incident.title,
            severity: incident.severity,
            service: incident.service,
            labels: (incident as { labels?: Record<string, string> }).labels ?? {},
          },
          { signal: budget.signal },
        )
        publish('investigation.milestone', { phase: 'triage', summary: triage.brief, severity: triage.severity })

        const hostTools = await getTools(projectId)
        const inventory = hostTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          costHint: tool.costHint,
          latencyHintMs: tool.latencyHintMs,
        }))
        const rawPlan = await driver.plan({ triage, inventory }, { signal: budget.signal })
        const plan = validatePlan(rawPlan, new Set(inventory.map((tool) => tool.name)))
        for (const warning of plan.warnings) console.warn(`[engine] ${warning}`)
        publish('investigation.milestone', {
          phase: 'plan',
          specialists: plan.specialists.map((spec) => spec.name),
          warnings: plan.warnings,
        })

        const knownEvidenceIds = new Set<string>()
        const driverTools = bindTools({
          hostTools,
          incidentId,
          budget,
          record: async (entry) => {
            const evidence = await appendEvidence(opts.db, { investigationId: investigation.id, ...entry })
            knownEvidenceIds.add(evidence.id)
            return { id: evidence.id }
          },
        })
        const toolsByName = new Map(driverTools.map((tool) => [tool.name, tool]))

        const findings: Array<{ specialist: string; summary: string; evidenceIds: string[] }> = []
        await Promise.allSettled(
          plan.specialists.map(async (spec) => {
            const tools = spec.toolNames
              .map((name) => toolsByName.get(name))
              .filter((tool): tool is DriverTool => tool !== undefined)
            try {
              const result = await driver.runSpecialist(
                { name: spec.name, objective: spec.objective, brief: triage.brief },
                tools,
                { signal: budget.signal },
              )
              const evidenceIds = result.evidenceIds.filter((id) => knownEvidenceIds.has(id))
              await addFinding(opts.db, {
                investigationId: investigation.id,
                specialist: spec.name,
                summary: result.summary,
                evidenceIds,
              })
              findings.push({ specialist: spec.name, summary: result.summary, evidenceIds })
              publish('investigation.milestone', {
                phase: 'specialist',
                specialist: spec.name,
                summary: result.summary,
              })
            } catch (err) {
              if (err instanceof BudgetExceededError || budget.signal.aborted) {
                publish('investigation.milestone', {
                  phase: 'specialist',
                  specialist: spec.name,
                  aborted: 'budget exhausted',
                })
                return
              }
              const message = err instanceof Error ? err.message : String(err)
              console.warn(`[engine] specialist ${spec.name} failed: ${message}`)
              publish('investigation.milestone', { phase: 'specialist', specialist: spec.name, error: message })
            }
          }),
        )

        const pastIncidents = await recallSimilarIncidents({
          db: opts.db,
          projectId,
          embedder: opts.embedder,
          query: triage.brief,
        })
        const evidence = await listEvidence(opts.db, investigation.id)
        const synthesis = await driver.synthesize({
          brief: triage.brief,
          findings,
          evidence: evidence.map((record) => ({ id: record.id, toolName: record.toolName, summary: record.summary })),
          pastIncidents,
        })
        const evidenceChain = filterEvidenceChain(
          synthesis.evidenceChain,
          new Set(evidence.map((record) => record.id)),
        )
        const diagnosis = await createDiagnosis(opts.db, {
          investigationId: investigation.id,
          rootCause: synthesis.rootCause,
          confidence: synthesis.confidence,
          evidenceChain,
          remediation: synthesis.remediation,
          openQuestions: synthesis.openQuestions,
        })
        await updateIncidentStatus(opts.db, incidentId, 'diagnosed')
        publish('diagnosis.ready', {
          rootCause: synthesis.rootCause,
          confidence: synthesis.confidence,
          diagnosisId: diagnosis.id,
        })
        await storeIncidentMemory({
          db: opts.db,
          projectId,
          embedder: opts.embedder,
          title: incident.title,
          rootCause: synthesis.rootCause,
          metadata: { incidentId, diagnosisId: diagnosis.id },
        })
        const stats = budget.stats()
        await completeInvestigation(opts.db, investigation.id, {
          status: budget.exceeded ? 'budget_exceeded' : 'completed',
          stats: { toolCalls: stats.toolCalls, wallMs: stats.wallMs, specialists: findings.length },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        publish('investigation.milestone', { phase: 'error', error: message })
        const stats = budget.stats()
        await completeInvestigation(opts.db, investigation.id, {
          status: 'failed',
          stats: { toolCalls: stats.toolCalls, wallMs: stats.wallMs, specialists: 0 },
        })
        throw err
      } finally {
        budget.dispose()
      }
    },
  }
}
