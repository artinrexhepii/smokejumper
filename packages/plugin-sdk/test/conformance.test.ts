import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AlertSource } from '../src/contracts'
import { checkAlertSource, checkNotificationSink, checkTelemetrySource } from '../src/conformance'
import {
  createFakeAlertSource,
  createFakeNotificationSink,
  createFakeTelemetrySource,
  createTestContext,
} from '../src/testing'

const alertFixtures = {
  config: { token: 'secret' },
  validRequest: { headers: { 'x-smokejumper-token': 'secret' }, body: {}, rawBody: '{}' },
  invalidRequest: { headers: {}, body: {}, rawBody: '{}' },
  samplePayloads: [{ message: 'disk full', level: 'high', service: 'db', key: 'db-disk' }],
}

describe('checkAlertSource', () => {
  it('passes for the fake alert source', async () => {
    const result = await checkAlertSource(createFakeAlertSource(), alertFixtures)
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('fails for a source with a wrong manifest kind and broken normalize', async () => {
    const broken: AlertSource<{ token: string }> = {
      manifest: {
        id: 'broken',
        name: 'Broken',
        version: '0.1.0',
        sdkVersion: '0.1.0',
        kind: 'telemetry-source',
        description: 'Broken source',
        configSchema: z.object({}),
      },
      async verify() {
        return true
      },
      normalize() {
        return { nonsense: true } as never
      },
    }
    const result = await checkAlertSource(broken, alertFixtures)
    expect(result.pass).toBe(false)
    expect(result.failures.some((f) => f.includes('kind'))).toBe(true)
    expect(result.failures.some((f) => f.includes('verify() accepted'))).toBe(true)
    expect(result.failures.some((f) => f.includes('failed validation'))).toBe(true)
  })
})

describe('checkTelemetrySource', () => {
  it('passes for the fake telemetry source', async () => {
    const result = await checkTelemetrySource(createFakeTelemetrySource(), createTestContext({ prefix: '' }))
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })
})

describe('checkNotificationSink', () => {
  it('passes for the fake notification sink', async () => {
    const result = await checkNotificationSink(createFakeNotificationSink(), {
      ...createTestContext({}),
    })
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })
})
