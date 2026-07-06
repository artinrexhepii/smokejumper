import { beforeAll, describe, expect, it } from 'vitest'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createPrometheusTelemetrySource, type PrometheusConfig } from '../src/index'

const enabled = process.env.SMOKEJUMPER_INTEGRATION === '1'
const config: PrometheusConfig = { url: process.env.SMOKEJUMPER_PROMETHEUS_URL ?? 'http://localhost:9090' }
const source = createPrometheusTelemetrySource()

async function waitForSelfScrapeTarget(): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await fetch(`${config.url}/api/v1/query?query=up`)
    const body = (await res.json()) as { data: { result: Array<{ value: [number, string] }> } }
    if (body.data.result.some((r) => r.value[1] === '1')) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('prometheus self-scrape target never came up')
}

describe.skipIf(!enabled)('prometheus integration', () => {
  beforeAll(async () => {
    await waitForSelfScrapeTarget()
  }, 40_000)

  it('reports healthy against the real server', async () => {
    const health = await source.healthCheck(createTestContext<PrometheusConfig>(config))
    expect(health.ok).toBe(true)
  })

  it('runs an instant query against the self-scrape target', async () => {
    const ctx = { ...createTestContext<PrometheusConfig>(config), incidentId: 'inc-1' }
    const tool = source.tools().find((t) => t.name === 'instant_query')!
    const result = await tool.execute(tool.inputSchema.parse({ query: 'up{job="prometheus"}' }), ctx)
    const data = result.data as { result: Array<{ value: [number, string] }> }
    expect(data.result[0]?.value[1]).toBe('1')
  })

  it('lists the self-scrape target as healthy', async () => {
    const ctx = { ...createTestContext<PrometheusConfig>(config), incidentId: 'inc-1' }
    const tool = source.tools().find((t) => t.name === 'list_targets')!
    const result = await tool.execute(tool.inputSchema.parse({ state: 'active' }), ctx)
    const data = result.data as { activeTargets: Array<{ health: string }> }
    expect(data.activeTargets.some((t) => t.health === 'up')).toBe(true)
  })
})
