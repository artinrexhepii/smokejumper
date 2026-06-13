import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkAlertSource, type NormalizedAlert } from '@smokejumper/plugin-sdk'
import { createSentryAlertSource } from '../src/index'
import { sentryEventAlert } from './fixtures/event-alert'

const source = createSentryAlertSource()
const config = { clientSecret: 'shhh-sentry-secret' }
const rawBody = JSON.stringify(sentryEventAlert)
const signature = createHmac('sha256', config.clientSecret).update(rawBody, 'utf8').digest('hex')

describe('sentry alert source', () => {
  it('passes conformance with a real computed signature', async () => {
    const result = await checkAlertSource(source, {
      config,
      validRequest: { headers: { 'sentry-hook-signature': signature }, body: sentryEventAlert, rawBody },
      invalidRequest: { headers: { 'sentry-hook-signature': '0'.repeat(64) }, body: sentryEventAlert, rawBody },
      samplePayloads: [sentryEventAlert],
    })
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('rejects requests without a signature header', async () => {
    expect(await source.verify({ headers: {}, body: sentryEventAlert, rawBody }, config)).toBe(false)
  })

  it('rejects a signature computed with the wrong secret', async () => {
    const wrong = createHmac('sha256', 'other-secret').update(rawBody, 'utf8').digest('hex')
    expect(
      await source.verify({ headers: { 'sentry-hook-signature': wrong }, body: sentryEventAlert, rawBody }, config),
    ).toBe(false)
  })

  it('normalizes the event alert payload', () => {
    const alert = source.normalize(sentryEventAlert, config) as NormalizedAlert
    expect(alert.title).toBe('TypeError: Cannot read properties of undefined (reading "id")')
    expect(alert.severity).toBe('high')
    expect(alert.service).toBe('shop-api')
    expect(alert.dedupKey).toBe('sentry-1117540176')
    expect(alert.labels.url).toBe(sentryEventAlert.data.event.web_url)
    expect(alert.labels.rule).toBe('High error volume')
    expect(alert.occurredAt).toBe('2026-07-04T09:14:31.000Z')
  })

  it('maps sentry levels onto smokejumper severities', () => {
    const withLevel = (level: string) => ({
      ...sentryEventAlert,
      data: { ...sentryEventAlert.data, event: { ...sentryEventAlert.data.event, level } },
    })
    const severityOf = (level: string) => (source.normalize(withLevel(level), config) as NormalizedAlert).severity
    expect(severityOf('fatal')).toBe('critical')
    expect(severityOf('error')).toBe('high')
    expect(severityOf('warning')).toBe('medium')
    expect(severityOf('info')).toBe('info')
    expect(severityOf('something-new')).toBe('medium')
  })

  it('falls back to the event id when the issue id is missing', () => {
    const noIssue = {
      ...sentryEventAlert,
      data: { ...sentryEventAlert.data, event: { ...sentryEventAlert.data.event, issue_id: undefined } },
    }
    const alert = source.normalize(noIssue, config) as NormalizedAlert
    expect(alert.dedupKey).toBe('sentry-e4874d664c3540c1a32eab185f12c5ab')
  })
})
