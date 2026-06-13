import type { HostTool } from '@smokejumper/plugin-host'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { BudgetExceededError, createBudget } from '../src/budget'
import { bindTools, type EvidenceEntry } from '../src/recorder'

function stubHostTool(run: HostTool['run']): HostTool {
  return {
    instanceId: 'inst-1',
    pluginId: 'stub',
    name: 'stub_lookup',
    description: 'Looks up a value',
    inputSchema: z.object({ key: z.string() }),
    costHint: 'cheap',
    latencyHintMs: 1,
    run,
  }
}

function memoryEvidence() {
  const entries: EvidenceEntry[] = []
  return {
    entries,
    record: async (entry: EvidenceEntry) => {
      entries.push(entry)
      return { id: `ev-${entries.length}` }
    },
  }
}

describe('bindTools', () => {
  it('records successful calls as evidence and returns the evidence id', async () => {
    const evidence = memoryEvidence()
    const budget = createBudget({ maxToolCalls: 5, maxWallMs: 60_000 })
    const [tool] = bindTools({
      hostTools: [stubHostTool(async () => ({ summary: 'found it', data: { value: 42 } }))],
      incidentId: 'inc-1',
      budget,
      record: evidence.record,
    })
    const call = await tool!.call({ key: 'a' })
    expect(call).toEqual({ evidenceId: 'ev-1', summary: 'found it', data: { value: 42 }, failed: false })
    expect(evidence.entries[0]).toEqual({
      toolName: 'stub_lookup',
      input: { key: 'a' },
      output: { value: 42 },
      summary: 'found it',
    })
    budget.dispose()
  })

  it('contains tool failures as evidence of absence', async () => {
    const evidence = memoryEvidence()
    const budget = createBudget({ maxToolCalls: 5, maxWallMs: 60_000 })
    const [tool] = bindTools({
      hostTools: [
        stubHostTool(async () => {
          throw new Error('backend unreachable')
        }),
      ],
      incidentId: 'inc-1',
      budget,
      record: evidence.record,
    })
    const call = await tool!.call({ key: 'a' })
    expect(call.failed).toBe(true)
    expect(call.evidenceId).toBe('ev-1')
    expect(call.summary).toContain('backend unreachable')
    expect(evidence.entries[0]!.output).toEqual({ error: 'backend unreachable' })
    budget.dispose()
  })

  it('throws BudgetExceededError without touching the plugin once the budget is spent', async () => {
    const evidence = memoryEvidence()
    const budget = createBudget({ maxToolCalls: 1, maxWallMs: 60_000 })
    let runs = 0
    const [tool] = bindTools({
      hostTools: [
        stubHostTool(async () => {
          runs += 1
          return { summary: 'ok', data: null }
        }),
      ],
      incidentId: 'inc-1',
      budget,
      record: evidence.record,
    })
    await tool!.call({ key: 'a' })
    await expect(tool!.call({ key: 'b' })).rejects.toBeInstanceOf(BudgetExceededError)
    expect(runs).toBe(1)
    expect(evidence.entries).toHaveLength(1)
    budget.dispose()
  })

  it('passes the budget abort signal and incident id to the host tool', async () => {
    const evidence = memoryEvidence()
    const budget = createBudget({ maxToolCalls: 5, maxWallMs: 60_000 })
    let seen: { incidentId: string; signal: AbortSignal } | undefined
    const [tool] = bindTools({
      hostTools: [
        stubHostTool(async (_input, opts) => {
          seen = opts
          return { summary: 'ok', data: null }
        }),
      ],
      incidentId: 'inc-42',
      budget,
      record: evidence.record,
    })
    await tool!.call({ key: 'a' })
    expect(seen?.incidentId).toBe('inc-42')
    expect(seen?.signal).toBe(budget.signal)
    budget.dispose()
  })
})
