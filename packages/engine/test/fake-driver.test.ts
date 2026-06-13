import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SPECIALIST_NAMES, type DriverTool } from '../src/driver'
import { createFakeDriver } from '../src/fake-driver'
import { validatePlan } from '../src/plan-validation'

const signal = new AbortController().signal
const driver = createFakeDriver()
const triageInput = { title: 'api: error rate spike', severity: 'high', service: 'api', labels: {} }

describe('fake driver', () => {
  it('triages deterministically from the incident fields', async () => {
    const first = await driver.triage(triageInput, { signal })
    const second = await driver.triage(triageInput, { signal })
    expect(first).toEqual(second)
    expect(first.brief).toContain('api: error rate spike')
    expect(first.affectedService).toBe('api')
    expect(first.severity).toBe('high')
  })

  it('falls back to medium severity for unknown severities', async () => {
    const triage = await driver.triage({ ...triageInput, severity: 'urgent' }, { signal })
    expect(triage.severity).toBe('medium')
  })

  it('plans every specialist with the full tool inventory', async () => {
    const triage = await driver.triage(triageInput, { signal })
    const plan = await driver.plan(
      {
        triage,
        inventory: [
          { name: 'docker_container_logs', description: 'logs', costHint: 'cheap', latencyHintMs: 50 },
          { name: 'http_http_check', description: 'http', costHint: 'cheap', latencyHintMs: 100 },
        ],
      },
      { signal },
    )
    expect(plan.specialists.map((s) => s.name)).toEqual([...SPECIALIST_NAMES])
    for (const spec of plan.specialists) {
      expect(spec.toolNames).toEqual(['docker_container_logs', 'http_http_check'])
    }
  })

  it('calls the first tool once with schema-valid input and cites the evidence', async () => {
    const inputs: unknown[] = []
    const tool: DriverTool = {
      name: 'docker_container_logs',
      description: 'logs',
      inputSchema: z.object({ container: z.string(), tail: z.number().optional() }),
      call: async (input) => {
        inputs.push(input)
        return { evidenceId: 'ev-7', summary: 'no errors in logs', data: {}, failed: false }
      },
    }
    const result = await driver.runSpecialist(
      { name: 'log-analyst', objective: 'check logs', brief: 'brief' },
      [tool],
      { signal },
    )
    expect(inputs).toHaveLength(1)
    expect(() => tool.inputSchema.parse(inputs[0])).not.toThrow()
    expect(result.evidenceIds).toEqual(['ev-7'])
    expect(result.summary).toContain('no errors in logs')
  })

  it('reports absence when a specialist has no tools', async () => {
    const result = await driver.runSpecialist(
      { name: 'metrics-analyst', objective: 'check metrics', brief: 'brief' },
      [],
      { signal },
    )
    expect(result.evidenceIds).toEqual([])
    expect(result.summary).toContain('no tools')
  })

  it('synthesizes a diagnosis citing the findings evidence at confidence 0.5', async () => {
    const result = await driver.synthesize({
      brief: 'the brief',
      findings: [
        { specialist: 'log-analyst', summary: 'saw OOM kills', evidenceIds: ['ev-1'] },
        { specialist: 'metrics-analyst', summary: 'nothing to report', evidenceIds: [] },
      ],
      evidence: [{ id: 'ev-1', toolName: 'docker_container_logs', summary: 'OOM' }],
      pastIncidents: [],
    })
    expect(result.confidence).toBe(0.5)
    expect(result.rootCause).toContain('the brief')
    expect(result.evidenceChain).toEqual([{ claim: 'saw OOM kills', evidenceIds: ['ev-1'] }])
  })
})

describe('validatePlan', () => {
  it('drops unknown tools with a warning and dedupes repeated specialists', () => {
    const { specialists, warnings } = validatePlan(
      {
        specialists: [
          { name: 'log-analyst', toolNames: ['real_tool', 'ghost_tool'], objective: 'a' },
          { name: 'log-analyst', toolNames: ['real_tool'], objective: 'b' },
        ],
      },
      new Set(['real_tool']),
    )
    expect(specialists).toEqual([{ name: 'log-analyst', toolNames: ['real_tool'], objective: 'a' }])
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('ghost_tool')
  })
})
