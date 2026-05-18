import type { z } from 'zod'
import type { SourceContext } from './context'

export type CostHint = 'cheap' | 'moderate' | 'expensive'

export interface ToolResult {
  summary: string
  data: unknown
}

export interface ToolContext<TConfig = unknown> extends SourceContext<TConfig> {
  incidentId: string
}

export interface ToolSpec<TConfig = unknown> {
  name: string
  description: string
  inputSchema: z.ZodTypeAny
  scope: 'read'
  costHint: CostHint
  latencyHintMs: number
  execute(input: unknown, ctx: ToolContext<TConfig>): Promise<ToolResult>
}
