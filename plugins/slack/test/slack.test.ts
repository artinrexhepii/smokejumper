import { describe, expect, it } from 'vitest'
import { checkNotificationSink, type IncidentEvent, type SinkContext } from '@smokejumper/plugin-sdk'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createSlackNotificationSink, toMrkdwn, type SlackConfig } from '../src/index'

const sink = createSlackNotificationSink()
const config: SlackConfig = { botToken: 'xoxb-test-token', channel: '#incidents' }

interface CapturedRequest {
  url: string
  headers: Record<string, string>
  body: unknown
}

function slackContext(response: () => Response) {
  const requests: CapturedRequest[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    })
    return response()
  }) as typeof fetch
  const ctx: SinkContext<SlackConfig> = { ...createTestContext(config), fetch: fetchImpl }
  return { ctx, requests }
}

const event: IncidentEvent = {
  type: 'diagnosis.ready',
  incidentId: 'inc-1',
  projectId: 'proj-1',
  occurredAt: '2026-07-04T10:00:00.000Z',
  payload: {},
}

describe('toMrkdwn', () => {
  it('converts double-asterisk bold to slack mrkdwn', () => {
    expect(toMrkdwn('**Root cause:** OOM and **Confidence:** 85%')).toBe('*Root cause:* OOM and *Confidence:* 85%')
  })

  it('leaves plain text untouched', () => {
    expect(toMrkdwn('nothing bold here')).toBe('nothing bold here')
  })
})

describe('slack notification sink', () => {
  it('passes conformance', async () => {
    const { ctx } = slackContext(() => Response.json({ ok: true, ts: '1751623200.000100' }))
    const result = await checkNotificationSink(sink, ctx)
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('posts to chat.postMessage with the bot token and channel', async () => {
    const { ctx, requests } = slackContext(() => Response.json({ ok: true, ts: '1751623200.000100' }))
    const receipt = await sink.notify(event, { title: 'Diagnosis ready', markdown: '**Root cause:** OOM' }, ctx)
    expect(receipt).toEqual({ delivered: true, externalId: '1751623200.000100' })
    expect(requests[0]!.url).toBe('https://slack.com/api/chat.postMessage')
    expect(requests[0]!.headers.authorization).toBe('Bearer xoxb-test-token')
    expect(requests[0]!.body).toEqual({ channel: '#incidents', text: 'Diagnosis ready\n*Root cause:* OOM' })
  })

  it('reports slack api errors without throwing', async () => {
    const { ctx } = slackContext(() => Response.json({ ok: false, error: 'channel_not_found' }))
    const receipt = await sink.notify(event, { title: 'T', markdown: 'm' }, ctx)
    expect(receipt.delivered).toBe(false)
    expect(receipt.error).toBe('channel_not_found')
  })

  it('reports network failures without throwing', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const ctx: SinkContext<SlackConfig> = { ...createTestContext(config), fetch: fetchImpl }
    const receipt = await sink.notify(event, { title: 'T', markdown: 'm' }, ctx)
    expect(receipt).toEqual({ delivered: false, error: 'fetch failed' })
  })
})
