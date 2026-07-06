import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AlertSourceRequest } from '@smokejumper/plugin-sdk'
import { createAlertmanagerAlertSource, type AlertmanagerConfig } from '../src/index'

const enabled = process.env.SMOKEJUMPER_INTEGRATION === '1'
const alertmanagerUrl = process.env.SMOKEJUMPER_ALERTMANAGER_URL ?? 'http://localhost:9093'
const webhookPort = 9095
const source = createAlertmanagerAlertSource()
const config: AlertmanagerConfig = { severityLabel: 'severity', token: 'integration-test-token' }

function waitForWebhook(server: Server): Promise<AlertSourceRequest> {
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

describe.skipIf(!enabled)('alertmanager integration', () => {
  let server: Server
  let received: Promise<AlertSourceRequest>

  beforeAll(async () => {
    server = createServer()
    received = waitForWebhook(server)
    await new Promise<void>((resolve) => server.listen(webhookPort, resolve))
  })

  afterAll(() => {
    server.close()
  })

  it(
    'receives a real alertmanager webhook and normalizes it',
    async () => {
      const startsAt = new Date().toISOString()
      // Alertmanager suppresses a repeat notification for an already-active alert group until
      // repeat_interval (1h) elapses, so a fixed-label probe only fires against a fresh container.
      // A per-run-unique label makes each run a distinct alert that dispatches its own webhook.
      const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const postRes = await fetch(`${alertmanagerUrl}/api/v2/alerts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([
          {
            labels: { alertname: 'IntegrationProbe', severity: 'critical', service: 'smokejumper-integration', probe: runId },
            annotations: { summary: 'integration probe alert' },
            startsAt,
          },
        ]),
      })
      expect(postRes.ok).toBe(true)

      const req = await received
      expect(await source.verify(req, config)).toBe(true)

      const alerts = source.normalize(req.body, config)
      const list = Array.isArray(alerts) ? alerts : [alerts]
      const probe = list.find((alert) => alert.labels.probe === runId)
      expect(probe).toBeDefined()
      expect(probe?.title).toBe('integration probe alert')
      expect(probe?.severity).toBe('critical')
      expect(probe?.service).toBe('smokejumper-integration')
    },
    30_000,
  )
})
