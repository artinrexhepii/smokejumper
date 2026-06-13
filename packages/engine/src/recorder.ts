import type { HostTool } from '@smokejumper/plugin-host'
import { BudgetExceededError, type Budget } from './budget'
import type { DriverTool } from './driver'

export interface EvidenceEntry {
  toolName: string
  input: unknown
  output: unknown
  summary: string
}

export type EvidenceWriter = (entry: EvidenceEntry) => Promise<{ id: string }>

export function bindTools(opts: {
  hostTools: HostTool[]
  incidentId: string
  budget: Budget
  record: EvidenceWriter
}): DriverTool[] {
  return opts.hostTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async call(input) {
      if (!opts.budget.tryConsume()) {
        throw new BudgetExceededError(`budget exhausted before calling ${tool.name}`)
      }
      try {
        const result = await tool.run(input, { incidentId: opts.incidentId, signal: opts.budget.signal })
        const evidence = await opts.record({
          toolName: tool.name,
          input,
          output: result.data,
          summary: result.summary,
        })
        return { evidenceId: evidence.id, summary: result.summary, data: result.data, failed: false }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const summary = `${tool.name} failed: ${message}`
        const evidence = await opts.record({
          toolName: tool.name,
          input,
          output: { error: message },
          summary,
        })
        return { evidenceId: evidence.id, summary, data: { error: message }, failed: true }
      }
    },
  }))
}
