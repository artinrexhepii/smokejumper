import { beforeAll, describe, expect, it } from 'vitest'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createLokiTelemetrySource, type LokiConfig } from '../src/index'

const enabled = process.env.SMOKEJUMPER_INTEGRATION === '1'
const config: LokiConfig = { url: process.env.SMOKEJUMPER_LOKI_URL ?? 'http://localhost:3100' }
const source = createLokiTelemetrySource()
const probeLine = 'smokejumper integration probe line'

async function pushProbeLine(): Promise<void> {
  const nowNs = (BigInt(Date.now()) * 1_000_000n).toString()
  const res = await fetch(`${config.url}/loki/api/v1/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ streams: [{ stream: { app: 'smokejumper-integration' }, values: [[nowNs, probeLine]] }] }),
  })
  if (!res.ok) throw new Error(`loki push failed: ${res.status}`)
}

describe.skipIf(!enabled)('loki integration', () => {
  beforeAll(async () => {
    await pushProbeLine()
  }, 20_000)

  it('reports healthy against the real server', async () => {
    const health = await source.healthCheck(createTestContext<LokiConfig>(config))
    expect(health.ok).toBe(true)
  })

  it('queries back the pushed log line', async () => {
    const ctx = { ...createTestContext<LokiConfig>(config), incidentId: 'inc-1' }
    const tool = source.tools().find((t) => t.name === 'query_range')!
    const result = await tool.execute(tool.inputSchema.parse({ query: '{app="smokejumper-integration"}', minutesAgo: 5 }), ctx)
    const lines = result.data as Array<{ line: string }>
    expect(lines.some((l) => l.line === probeLine)).toBe(true)
  })

  it('lists the app label', async () => {
    const ctx = { ...createTestContext<LokiConfig>(config), incidentId: 'inc-1' }
    const tool = source.tools().find((t) => t.name === 'labels')!
    const result = await tool.execute(tool.inputSchema.parse({}), ctx)
    expect(result.data as string[]).toContain('app')
  })
})
