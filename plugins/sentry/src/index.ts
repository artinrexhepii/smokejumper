import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { AlertSource, NormalizedAlert, Severity } from '@smokejumper/plugin-sdk'

export const sentryConfigSchema = z.object({ clientSecret: z.string().min(1) })

export type SentryConfig = z.infer<typeof sentryConfigSchema>

const sentryPayloadSchema = z.object({
  data: z.object({
    event: z.object({
      event_id: z.string().min(1),
      issue_id: z.union([z.string(), z.number()]).optional(),
      title: z.string().min(1),
      level: z.string().optional(),
      datetime: z.string().optional(),
      url: z.string().optional(),
      web_url: z.string().optional(),
      tags: z.array(z.array(z.string())).optional(),
    }),
    triggered_rule: z.string().optional(),
  }),
})

type SentryEvent = z.infer<typeof sentryPayloadSchema>['data']['event']

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function mapLevel(level: string | undefined): Severity {
  switch (level) {
    case 'fatal':
      return 'critical'
    case 'error':
      return 'high'
    case 'warning':
      return 'medium'
    case 'info':
    case 'debug':
      return 'info'
    default:
      return 'medium'
  }
}

function extractService(event: SentryEvent): string {
  const fromUrl = event.url?.match(/\/api\/0\/projects\/[^/]+\/([^/]+)\//)
  if (fromUrl?.[1]) return fromUrl[1]
  const serverName = event.tags?.find((tag) => tag[0] === 'server_name')?.[1]
  return serverName ?? 'sentry'
}

export function createSentryAlertSource(): AlertSource<SentryConfig> {
  return {
    manifest: {
      id: 'sentry',
      name: 'Sentry',
      version: '0.1.0',
      sdkVersion: '0.1.0',
      kind: 'alert-source',
      description: 'Ingests Sentry issue alert webhooks',
      configSchema: sentryConfigSchema,
    },
    async verify(req, config) {
      const signature = req.headers['sentry-hook-signature']
      if (typeof signature !== 'string' || signature.length === 0) return false
      const digest = createHmac('sha256', config.clientSecret).update(req.rawBody, 'utf8').digest('hex')
      return safeEqual(digest, signature)
    },
    normalize(payload): NormalizedAlert {
      const { data } = sentryPayloadSchema.parse(payload)
      const event = data.event
      const labels: Record<string, string> = {}
      if (event.web_url) labels.url = event.web_url
      if (event.level) labels.level = event.level
      if (data.triggered_rule) labels.rule = data.triggered_rule
      const occurredAt =
        event.datetime && !Number.isNaN(Date.parse(event.datetime))
          ? new Date(event.datetime).toISOString()
          : new Date().toISOString()
      return {
        title: event.title,
        severity: mapLevel(event.level),
        service: extractService(event),
        labels,
        dedupKey: `sentry-${event.issue_id ?? event.event_id}`,
        occurredAt,
        raw: payload,
      }
    },
  }
}
