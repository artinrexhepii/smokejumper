import { describe, expect, it } from 'vitest'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createGrafanaTelemetrySource, type GrafanaConfig } from '../src/index'

const enabled = process.env.SMOKEJUMPER_INTEGRATION === '1' && Boolean(process.env.SMOKEJUMPER_GRAFANA_URL)
const config: GrafanaConfig = {
  url: process.env.SMOKEJUMPER_GRAFANA_URL ?? 'http://localhost:3000',
  apiToken: process.env.SMOKEJUMPER_GRAFANA_API_TOKEN ?? '',
}
const source = createGrafanaTelemetrySource()

describe.skipIf(!enabled)('grafana integration', () => {
  it('reports healthy against a real grafana instance', async () => {
    const health = await source.healthCheck(createTestContext<GrafanaConfig>(config))
    expect(health.ok).toBe(true)
  })

  it('lists datasources from a real grafana instance', async () => {
    const ctx = { ...createTestContext<GrafanaConfig>(config), incidentId: 'inc-1' }
    const tool = source.tools().find((t) => t.name === 'list_datasources')!
    const result = await tool.execute(tool.inputSchema.parse({}), ctx)
    expect(Array.isArray(result.data)).toBe(true)
  })
})
