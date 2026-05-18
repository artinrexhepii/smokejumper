import { describe, expect, it } from 'vitest'
import { normalizedAlertSchema } from '../src/alert'
import {
  createFakeAlertSource,
  createFakeNotificationSink,
  createFakeTelemetrySource,
  createTestContext,
} from '../src/testing'

describe('fake alert source', () => {
  const source = createFakeAlertSource()
  const config = { token: 'secret' }

  it('verifies requests by token header', async () => {
    const good = { headers: { 'x-smokejumper-token': 'secret' }, body: {}, rawBody: '{}' }
    const bad = { headers: { 'x-smokejumper-token': 'wrong' }, body: {}, rawBody: '{}' }
    expect(await source.verify(good, config)).toBe(true)
    expect(await source.verify(bad, config)).toBe(false)
  })

  it('normalizes payloads into valid alerts', () => {
    const alert = source.normalize(
      { message: 'db timeouts', level: 'high', service: 'db', key: 'db-timeout' },
      config,
    )
    expect(normalizedAlertSchema.safeParse(alert).success).toBe(true)
  })
})

describe('fake telemetry source', () => {
  const source = createFakeTelemetrySource()

  it('reports healthy', async () => {
    const health = await source.healthCheck(createTestContext({ prefix: '' }))
    expect(health.ok).toBe(true)
  })

  it('exposes a working echo tool', async () => {
    const tool = source.tools()[0]!
    const ctx = { ...createTestContext({ prefix: '>> ' }), incidentId: 'inc-1' }
    const result = await tool.execute(tool.inputSchema.parse({ text: 'hi' }), ctx)
    expect(result.data).toBe('>> hi')
  })
})

describe('fake notification sink', () => {
  it('records deliveries', async () => {
    const sink = createFakeNotificationSink()
    const receipt = await sink.notify(
      {
        type: 'diagnosis.ready',
        incidentId: 'inc-1',
        projectId: 'proj-1',
        occurredAt: '2026-07-03T10:20:00.000Z',
        payload: {},
      },
      { title: 'Diagnosis ready', markdown: '**root cause:** OOM' },
      { ...createTestContext({}), projectId: 'proj-1' },
    )
    expect(receipt.delivered).toBe(true)
    expect(sink.deliveries).toHaveLength(1)
    expect(sink.deliveries[0]!.rendering.title).toBe('Diagnosis ready')
  })
})
