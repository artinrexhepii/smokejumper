import { describe, expect, it } from 'vitest'
import {
  createFakeAlertSource,
  createFakeNotificationSink,
  createFakeTelemetrySource,
} from '@smokejumper/plugin-sdk/testing'
import { createRegistry } from '../src/registry'

describe('createRegistry', () => {
  it('registers plugins and finds them by kind', () => {
    const registry = createRegistry()
    registry.register(createFakeAlertSource())
    registry.register(createFakeTelemetrySource())
    registry.register(createFakeNotificationSink())
    expect(registry.alertSource('fake-alerts')).toBeDefined()
    expect(registry.telemetrySource('fake-telemetry')).toBeDefined()
    expect(registry.notificationSink('fake-sink')).toBeDefined()
    expect(registry.manifests().map((m) => m.id).sort()).toEqual(['fake-alerts', 'fake-sink', 'fake-telemetry'])
  })

  it('returns undefined for unknown ids and kind mismatches', () => {
    const registry = createRegistry()
    registry.register(createFakeTelemetrySource())
    expect(registry.telemetrySource('nope')).toBeUndefined()
    expect(registry.alertSource('fake-telemetry')).toBeUndefined()
    expect(registry.notificationSink('fake-telemetry')).toBeUndefined()
  })

  it('rejects duplicate plugin ids', () => {
    const registry = createRegistry()
    registry.register(createFakeAlertSource())
    expect(() => registry.register(createFakeAlertSource())).toThrow(/already registered/)
  })

  it('rejects invalid manifests', () => {
    const registry = createRegistry()
    const source = createFakeAlertSource()
    expect(() =>
      registry.register({ ...source, manifest: { ...source.manifest, id: 'Bad Id!' } }),
    ).toThrow()
  })

  it('rejects action sinks in this phase', () => {
    const registry = createRegistry()
    const source = createFakeAlertSource()
    expect(() =>
      registry.register({ ...source, manifest: { ...source.manifest, id: 'restart', kind: 'action-sink' } }),
    ).toThrow(/not loadable/)
  })
})
