import { createHmac } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AlertSourceRequest, IncidentEvent } from '@smokejumper/plugin-sdk'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import {
  createPagerdutyAlertSource,
  createPagerdutyNotificationSink,
  type PagerdutyAlertConfig,
  type PagerdutyNotifyConfig,
} from '../src/index'
import { pagerdutyTriggeredWebhook } from '../test/fixtures/webhook'

const enabled = process.env.SMOKEJUMPER_INTEGRATION === '1'

function sign(body: string, key: string): string {
  return createHmac('sha256', key).update(body, 'utf8').digest('hex')
}

describe.skipIf(!enabled)('pagerduty alert source integration', () => {
  const alertSource = createPagerdutyAlertSource()
  const signingSecret = 'integration-signing-secret'
  const config: PagerdutyAlertConfig = { signingSecret }
  let server: Server
  let port: number

  function waitForWebhook(): Promise<AlertSourceRequest> {
    return new Promise((resolve) => {
      server.on('request', (req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8')
          res.writeHead(200).end()
          resolve({
            headers: Object.fromEntries(
              Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : (value ?? '')]),
            ),
            body: JSON.parse(rawBody) as unknown,
            rawBody,
          })
        })
      })
    })
  }

  beforeAll(async () => {
    server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not bind to a port')
    port = address.port
  })

  afterAll(() => {
    server.close()
  })

  it('receives a real signed webhook over the network and verifies + normalizes it', async () => {
    const received = waitForWebhook()
    const rawBody = JSON.stringify(pagerdutyTriggeredWebhook)
    const postRes = await fetch(`http://127.0.0.1:${port}/webhooks/pagerduty`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pagerduty-signature': `v1=${sign(rawBody, signingSecret)}` },
      body: rawBody,
    })
    expect(postRes.ok).toBe(true)

    const req = await received
    expect(await alertSource.verify(req, config)).toBe(true)
    const alerts = alertSource.normalize(req.body, config)
    const list = Array.isArray(alerts) ? alerts : [alerts]
    expect(list[0]!.title).toBe('shop-api error rate above threshold')
    expect(list[0]!.severity).toBe('critical')
  })
})

describe.skipIf(!enabled)('pagerduty notification sink integration', () => {
  const sink = createPagerdutyNotificationSink()
  const config: PagerdutyNotifyConfig = { routingKey: 'integration-routing-key' }
  let server: Server
  let port: number
  let received: Record<string, unknown> | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        received = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        res.writeHead(202, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 'success', message: 'Event processed', dedup_key: received?.dedup_key }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not bind to a port')
    port = address.port
  })

  afterAll(() => {
    server.close()
  })

  it('posts a real event over the network to the events API', async () => {
    const proxyFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const original = new URL(String(input))
      const proxied = new URL(`${original.pathname}${original.search}`, `http://127.0.0.1:${port}`)
      return fetch(proxied, init)
    }) as typeof fetch
    const ctx = { ...createTestContext<PagerdutyNotifyConfig>(config), fetch: proxyFetch }
    const event: IncidentEvent = {
      type: 'incident.opened',
      incidentId: 'inc-integration',
      projectId: 'proj-1',
      occurredAt: '2026-07-06T09:00:00.000Z',
      payload: { title: 'integration probe', severity: 'critical', service: 'smokejumper-integration' },
    }
    const receipt = await sink.notify(event, { title: 'Incident: integration probe', markdown: '**Severity:** critical' }, ctx)
    expect(receipt.delivered).toBe(true)
    expect(receipt.externalId).toBe('inc-integration')
    expect(received).toMatchObject({ routing_key: 'integration-routing-key', event_action: 'trigger', dedup_key: 'inc-integration' })
  })
})
