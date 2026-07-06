import { describe, expect, it } from 'vitest'
import { checkAlertSource, type NormalizedAlert } from '@smokejumper/plugin-sdk'
import { createAlertmanagerAlertSource } from '../src/index'
import { alertmanagerWebhook } from './fixtures/webhook'

const source = createAlertmanagerAlertSource()
const config = { severityLabel: 'severity', token: 'am-secret' }
const rawBody = JSON.stringify(alertmanagerWebhook)

describe('alertmanager alert source', () => {
  it('passes conformance', async () => {
    const result = await checkAlertSource(source, {
      config,
      validRequest: { headers: { authorization: 'Bearer am-secret' }, body: alertmanagerWebhook, rawBody },
      invalidRequest: { headers: { authorization: 'Bearer wrong-secret-value' }, body: alertmanagerWebhook, rawBody },
      samplePayloads: [alertmanagerWebhook],
    })
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('accepts any request when no token is configured', async () => {
    const open = { severityLabel: 'severity' }
    expect(await source.verify({ headers: {}, body: alertmanagerWebhook, rawBody }, open)).toBe(true)
  })

  it('rejects a missing authorization header when a token is configured', async () => {
    expect(await source.verify({ headers: {}, body: alertmanagerWebhook, rawBody }, config)).toBe(false)
  })

  it('rejects a token of the wrong length without throwing', async () => {
    expect(
      await source.verify({ headers: { authorization: 'Bearer short' }, body: alertmanagerWebhook, rawBody }, config),
    ).toBe(false)
  })

  it('emits one alert per firing alert and skips resolved ones', () => {
    const alerts = source.normalize(alertmanagerWebhook, config) as NormalizedAlert[]
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.title).toBe('shop-api error rate above 5%')
    expect(alerts[0]!.service).toBe('shop-api')
    expect(alerts[0]!.severity).toBe('critical')
    expect(alerts[0]!.dedupKey).toBe('abc123def456')
    expect(alerts[0]!.occurredAt).toBe('2026-07-05T09:00:00.000Z')
  })

  it('maps alertmanager severities onto smokejumper severities', () => {
    const withSeverity = (severity: string) => ({
      ...alertmanagerWebhook,
      alerts: [{ ...alertmanagerWebhook.alerts[0]!, labels: { ...alertmanagerWebhook.alerts[0]!.labels, severity } }],
    })
    const severityOf = (severity: string) =>
      (source.normalize(withSeverity(severity), config) as NormalizedAlert[])[0]!.severity
    expect(severityOf('critical')).toBe('critical')
    expect(severityOf('page')).toBe('high')
    expect(severityOf('error')).toBe('high')
    expect(severityOf('warning')).toBe('medium')
    expect(severityOf('warn')).toBe('medium')
    expect(severityOf('info')).toBe('low')
    expect(severityOf('something-new')).toBe('medium')
  })

  it('falls back to alertname:service when fingerprint is absent', () => {
    const noFingerprint = {
      ...alertmanagerWebhook,
      alerts: [{ ...alertmanagerWebhook.alerts[0]!, fingerprint: undefined }],
    }
    const alert = (source.normalize(noFingerprint, config) as NormalizedAlert[])[0]!
    expect(alert.dedupKey).toBe('HighErrorRate:shop-api')
  })

  it('falls back through the title and service label chains', () => {
    const minimal = {
      ...alertmanagerWebhook,
      alerts: [
        {
          status: 'firing' as const,
          labels: { alertname: 'NodeDown', job: 'node-exporter' },
          annotations: {},
          startsAt: '2026-07-05T09:05:00.000Z',
        },
      ],
    }
    const alert = (source.normalize(minimal, config) as NormalizedAlert[])[0]!
    expect(alert.title).toBe('NodeDown')
    expect(alert.service).toBe('node-exporter')
    expect(alert.labels).toEqual({ alertname: 'NodeDown', job: 'node-exporter' })
  })

  it('reads the severity label from a custom-configured label name', () => {
    const customLabel = { severityLabel: 'priority', token: 'am-secret' }
    const withPriority = {
      ...alertmanagerWebhook,
      alerts: [{ ...alertmanagerWebhook.alerts[0]!, labels: { ...alertmanagerWebhook.alerts[0]!.labels, priority: 'info' } }],
    }
    const alert = (source.normalize(withPriority, customLabel) as NormalizedAlert[])[0]!
    expect(alert.severity).toBe('low')
  })

  it('throws on a payload missing the alerts array', () => {
    expect(() => source.normalize({ status: 'firing' }, config)).toThrow()
  })
})
