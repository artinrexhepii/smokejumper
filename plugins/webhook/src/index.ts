import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { severitySchema, type AlertSource, type NormalizedAlert } from '@smokejumper/plugin-sdk'

export const webhookConfigSchema = z.object({ token: z.string().min(1) })

export type WebhookConfig = z.infer<typeof webhookConfigSchema>

export const webhookPayloadSchema = z.object({
  title: z.string().min(1),
  severity: severitySchema,
  service: z.string().min(1),
  labels: z.record(z.string()).optional(),
  dedupKey: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
})

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function toAlert(item: unknown): NormalizedAlert {
  const payload = webhookPayloadSchema.parse(item)
  return {
    title: payload.title,
    severity: payload.severity,
    service: payload.service,
    labels: payload.labels ?? {},
    dedupKey: payload.dedupKey,
    occurredAt: payload.occurredAt ?? new Date().toISOString(),
    raw: item,
  }
}

export function createWebhookAlertSource(): AlertSource<WebhookConfig> {
  return {
    manifest: {
      id: 'webhook',
      name: 'Generic Webhook',
      version: '0.1.0',
      sdkVersion: '0.1.0',
      kind: 'alert-source',
      description: 'Ingests alerts from any system that can POST JSON with a shared token',
      configSchema: webhookConfigSchema,
    },
    async verify(req, config) {
      const token = req.headers['x-smokejumper-token']
      return typeof token === 'string' && safeEqual(token, config.token)
    },
    normalize(payload) {
      if (Array.isArray(payload)) return payload.map(toAlert)
      return toAlert(payload)
    },
  }
}
