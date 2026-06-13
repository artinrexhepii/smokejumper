import { describe, expect, it } from 'vitest'
import { checkAlertSource, type NormalizedAlert } from '@smokejumper/plugin-sdk'
import { createWebhookAlertSource } from '../src/index'

const source = createWebhookAlertSource()
const config = { token: 'demo-token' }

const fullPayload = {
  title: 'shop-api: error rate spike',
  severity: 'high',
  service: 'shop-api',
  labels: { env: 'production' },
  dedupKey: 'shop-api-errors',
  occurredAt: '2026-07-04T09:00:00.000Z',
}

const minimalPayload = {
  title: 'worker: crash loop',
  severity: 'critical',
  service: 'worker',
  dedupKey: 'worker-crash',
}

describe('webhook alert source', () => {
  it('passes conformance', async () => {
    const rawBody = JSON.stringify(fullPayload)
    const result = await checkAlertSource(source, {
      config,
      validRequest: { headers: { 'x-smokejumper-token': 'demo-token' }, body: fullPayload, rawBody },
      invalidRequest: { headers: { 'x-smokejumper-token': 'wrong-token' }, body: fullPayload, rawBody },
      samplePayloads: [fullPayload, minimalPayload, [fullPayload, minimalPayload]],
    })
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('rejects a request without the token header', async () => {
    expect(await source.verify({ headers: {}, body: {}, rawBody: '{}' }, config)).toBe(false)
  })

  it('rejects a token of a different length without throwing', async () => {
    expect(
      await source.verify({ headers: { 'x-smokejumper-token': 'demo' }, body: {}, rawBody: '{}' }, config),
    ).toBe(false)
  })

  it('defaults labels and occurredAt when absent', () => {
    const alert = source.normalize(minimalPayload, config) as NormalizedAlert
    expect(alert.labels).toEqual({})
    expect(Number.isNaN(Date.parse(alert.occurredAt))).toBe(false)
    expect(alert.dedupKey).toBe('worker-crash')
  })

  it('normalizes an array payload into multiple alerts', () => {
    const alerts = source.normalize([fullPayload, minimalPayload], config) as NormalizedAlert[]
    expect(alerts).toHaveLength(2)
    expect(alerts[0]!.title).toBe('shop-api: error rate spike')
    expect(alerts[1]!.title).toBe('worker: crash loop')
  })

  it('throws on a payload missing required fields', () => {
    expect(() => source.normalize({ nonsense: true }, config)).toThrow()
  })
})
