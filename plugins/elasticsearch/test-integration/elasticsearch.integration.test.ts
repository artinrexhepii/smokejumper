import { beforeAll, describe, expect, it } from 'vitest'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createElasticsearchTelemetrySource, type ElasticsearchConfig } from '../src/index'

const enabled = process.env.SMOKEJUMPER_INTEGRATION === '1'
const config: ElasticsearchConfig = {
  url: process.env.SMOKEJUMPER_ELASTICSEARCH_URL ?? 'http://localhost:9200',
  indexPattern: 'sjlogs-integration-*',
}
const source = createElasticsearchTelemetrySource()
const probeMessage = 'smokejumper integration probe line'

async function indexProbeDocument(): Promise<void> {
  const indexRes = await fetch(`${config.url}/sjlogs-integration-test/_doc/1`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ '@timestamp': new Date().toISOString(), message: probeMessage }),
  })
  if (!indexRes.ok) throw new Error(`elasticsearch index failed: ${indexRes.status}`)
  const refreshRes = await fetch(`${config.url}/sjlogs-integration-test/_refresh`, { method: 'POST' })
  if (!refreshRes.ok) throw new Error(`elasticsearch refresh failed: ${refreshRes.status}`)
}

describe.skipIf(!enabled)('elasticsearch integration', () => {
  beforeAll(async () => {
    await indexProbeDocument()
  }, 20_000)

  it('reports healthy against the real cluster', async () => {
    const health = await source.healthCheck(createTestContext<ElasticsearchConfig>(config))
    expect(health.ok).toBe(true)
  })

  it('searches back the indexed probe document', async () => {
    const ctx = { ...createTestContext<ElasticsearchConfig>(config), incidentId: 'inc-1' }
    const tool = source.tools().find((t) => t.name === 'search_logs')!
    const result = await tool.execute(tool.inputSchema.parse({ query: 'message:probe', minutesAgo: 5 }), ctx)
    const entries = result.data as Array<{ source: Record<string, unknown> }>
    expect(entries.some((e) => e.source.message === probeMessage)).toBe(true)
  })

  it('lists the seeded index', async () => {
    const ctx = { ...createTestContext<ElasticsearchConfig>(config), incidentId: 'inc-1' }
    const tool = source.tools().find((t) => t.name === 'list_indices')!
    const result = await tool.execute(tool.inputSchema.parse({}), ctx)
    const indices = result.data as Array<{ index: string }>
    expect(indices.some((i) => i.index === 'sjlogs-integration-test')).toBe(true)
  })
})
