import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ToolContext, ToolSpec } from '../src/tool'

function makeContext(): ToolContext<{ prefix: string }> {
  return {
    projectId: 'proj-1',
    incidentId: 'inc-1',
    config: { prefix: '>> ' },
    fetch: globalThis.fetch,
    signal: new AbortController().signal,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  }
}

const echoTool: ToolSpec<{ prefix: string }> = {
  name: 'echo',
  description: 'Echoes back the provided text',
  inputSchema: z.object({ text: z.string() }),
  scope: 'read',
  costHint: 'cheap',
  latencyHintMs: 1,
  async execute(input, ctx) {
    const { text } = input as { text: string }
    return { summary: 'echoed', data: `${ctx.config.prefix}${text}` }
  },
}

describe('ToolSpec', () => {
  it('executes with host-parsed input and per-call config', async () => {
    const parsed = echoTool.inputSchema.parse({ text: 'hello' })
    const result = await echoTool.execute(parsed, makeContext())
    expect(result.data).toBe('>> hello')
  })

  it('rejects input that fails the schema', () => {
    expect(() => echoTool.inputSchema.parse({ text: 7 })).toThrow()
  })
})
