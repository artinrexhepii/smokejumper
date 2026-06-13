import { describe, expect, it } from 'vitest'
import { checkTelemetrySource, type ToolContext } from '@smokejumper/plugin-sdk'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createHttpTelemetrySource, type HttpConfig } from '../src/index'

const source = createHttpTelemetrySource()
const tool = source.tools()[0]!

function contextWith(fetchImpl: typeof fetch): ToolContext<HttpConfig> {
  return { ...createTestContext<HttpConfig>({}), fetch: fetchImpl, incidentId: 'inc-1' }
}

describe('http telemetry source', () => {
  it('passes conformance', async () => {
    const result = await checkTelemetrySource(source, createTestContext<HttpConfig>({}))
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('reports status, latency, and a body snippet', async () => {
    const ctx = contextWith((async () => new Response('x'.repeat(600), { status: 200 })) as typeof fetch)
    const result = await tool.execute(tool.inputSchema.parse({ url: 'http://shop-api.test/health' }), ctx)
    const data = result.data as { status: number; ok: boolean; latencyMs: number; bodySnippet: string }
    expect(data.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.latencyMs).toBeGreaterThanOrEqual(0)
    expect(data.bodySnippet).toHaveLength(500)
  })

  it('treats an unreachable endpoint as an observation, not a failure', async () => {
    const ctx = contextWith((async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch)
    const result = await tool.execute(tool.inputSchema.parse({ url: 'http://down.test/' }), ctx)
    expect(result.summary).toContain('unreachable')
    expect((result.data as { error: string }).error).toBe('fetch failed')
  })

  it('rejects non-url input', () => {
    expect(() => tool.inputSchema.parse({ url: 'not a url' })).toThrow()
  })
})
