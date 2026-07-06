import { describe, expect, it } from 'vitest'
import { describeConfig } from '@smokejumper/plugin-sdk'
import * as host from '../src/index'
import { createBuiltinRegistry } from '../src/builtin'

describe('createBuiltinRegistry', () => {
  it('registers all sixteen first-party plugins under their pinned ids', () => {
    const registry = createBuiltinRegistry()
    expect(registry.manifests().map((m) => m.id).sort()).toEqual([
      'alertmanager',
      'cloudwatch',
      'datadog',
      'docker',
      'elasticsearch',
      'github-deploys',
      'grafana',
      'http',
      'kubernetes',
      'loki',
      'pagerduty',
      'pagerduty-notify',
      'prometheus',
      'sentry',
      'slack',
      'webhook',
    ])
    expect(registry.alertSource('webhook')).toBeDefined()
    expect(registry.alertSource('sentry')).toBeDefined()
    expect(registry.alertSource('alertmanager')).toBeDefined()
    expect(registry.alertSource('pagerduty')).toBeDefined()
    expect(registry.telemetrySource('docker')).toBeDefined()
    expect(registry.telemetrySource('http')).toBeDefined()
    expect(registry.telemetrySource('github-deploys')).toBeDefined()
    expect(registry.telemetrySource('cloudwatch')).toBeDefined()
    expect(registry.telemetrySource('kubernetes')).toBeDefined()
    expect(registry.telemetrySource('prometheus')).toBeDefined()
    expect(registry.telemetrySource('loki')).toBeDefined()
    expect(registry.telemetrySource('datadog')).toBeDefined()
    expect(registry.telemetrySource('grafana')).toBeDefined()
    expect(registry.telemetrySource('elasticsearch')).toBeDefined()
    expect(registry.notificationSink('slack')).toBeDefined()
    expect(registry.notificationSink('pagerduty-notify')).toBeDefined()
    expect(registry.alertSource('docker')).toBeUndefined()
    expect(registry.telemetrySource('alertmanager')).toBeUndefined()
    expect(registry.telemetrySource('pagerduty')).toBeUndefined()
    expect(registry.notificationSink('pagerduty')).toBeUndefined()
  })

  it('produces a describeConfig-safe descriptor for every builtin manifest', () => {
    const registry = createBuiltinRegistry()
    const manifests = registry.manifests()
    expect(manifests.length).toBeGreaterThan(0)

    const supportedTypes = ['string', 'number', 'boolean', 'url', 'enum']
    for (const manifest of manifests) {
      expect(() => describeConfig(manifest)).not.toThrow()
      const descriptor = describeConfig(manifest)
      for (const field of [...descriptor.config, ...descriptor.credentials]) {
        expect(supportedTypes).toContain(field.type)
      }
    }
  })
})

describe('plugin-host exports', () => {
  it('exposes the public surface', () => {
    expect(host.createRegistry).toBeTypeOf('function')
    expect(host.createBuiltinRegistry).toBeTypeOf('function')
    expect(host.resolveInstance).toBeTypeOf('function')
    expect(host.createSourceContext).toBeTypeOf('function')
    expect(host.createSinkContext).toBeTypeOf('function')
    expect(host.getInstanceTools).toBeTypeOf('function')
    expect(host.startNotificationDispatcher).toBeTypeOf('function')
    expect(host.renderEvent).toBeTypeOf('function')
    expect(host.PluginConfigError).toBeTypeOf('function')
    expect(host.UnknownPluginError).toBeTypeOf('function')
    expect(host.InstanceNotFoundError).toBeTypeOf('function')
  })
})
