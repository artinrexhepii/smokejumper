import { describe, expect, it } from 'vitest'
import { normalizedAlertSchema } from '../src/alert'

const valid = {
  title: 'api: OOMKilled',
  severity: 'critical',
  service: 'api',
  labels: { env: 'production' },
  dedupKey: 'api-oom',
  occurredAt: '2026-07-03T10:15:00.000Z',
  raw: { original: true },
}

describe('normalizedAlertSchema', () => {
  it('accepts a valid alert', () => {
    expect(normalizedAlertSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects unknown severities', () => {
    expect(normalizedAlertSchema.safeParse({ ...valid, severity: 'urgent' }).success).toBe(false)
  })

  it('rejects an empty dedupKey', () => {
    expect(normalizedAlertSchema.safeParse({ ...valid, dedupKey: '' }).success).toBe(false)
  })

  it('rejects a non-ISO occurredAt', () => {
    expect(normalizedAlertSchema.safeParse({ ...valid, occurredAt: 'yesterday' }).success).toBe(false)
  })
})
