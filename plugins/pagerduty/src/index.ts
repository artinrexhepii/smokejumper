import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { AlertSource, NormalizedAlert, Severity } from '@smokejumper/plugin-sdk'

export const pagerdutyAlertConfigSchema = z.object({})

export const pagerdutyAlertCredentialSchema = z.object({
  signingSecret: z.string().min(1).optional(),
})

export type PagerdutyAlertConfig = z.infer<typeof pagerdutyAlertConfigSchema> & z.infer<typeof pagerdutyAlertCredentialSchema>

const pagerdutyReferenceSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  summary: z.string().optional(),
})

const pagerdutyIncidentDataSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
  incident_key: z.string().optional(),
  number: z.number().optional(),
  title: z.string().min(1),
  service: pagerdutyReferenceSchema.optional(),
  urgency: z.enum(['high', 'low']).optional(),
  priority: pagerdutyReferenceSchema.nullable().optional(),
})

const pagerdutyWebhookEventSchema = z.object({
  id: z.string().optional(),
  event_type: z.string().min(1),
  occurred_at: z.string().min(1),
  data: pagerdutyIncidentDataSchema,
})

export const pagerdutyWebhookPayloadSchema = z.object({
  event: pagerdutyWebhookEventSchema,
})

type PagerdutyIncidentData = z.infer<typeof pagerdutyIncidentDataSchema>
type PagerdutyWebhookEvent = z.infer<typeof pagerdutyWebhookEventSchema>

const TRIGGERING_EVENT_TYPES = new Set(['incident.triggered'])

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function computeSignature(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

function mapSeverity(data: PagerdutyIncidentData): Severity {
  switch (data.priority?.summary?.toUpperCase()) {
    case 'P1':
      return 'critical'
    case 'P2':
      return 'high'
    case 'P3':
      return 'medium'
    case 'P4':
      return 'low'
    case 'P5':
      return 'info'
  }
  if (data.urgency === 'high') return 'high'
  if (data.urgency === 'low') return 'low'
  return 'medium'
}

function toIso(value: string): string {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString()
}

function toNormalizedAlert(event: PagerdutyWebhookEvent): NormalizedAlert {
  const { data } = event
  return {
    title: data.title,
    severity: mapSeverity(data),
    service: data.service?.summary ?? 'unknown',
    labels: {
      status: data.status ?? 'unknown',
      urgency: data.urgency ?? 'unknown',
      ...(data.number !== undefined ? { incidentNumber: String(data.number) } : {}),
    },
    dedupKey: data.incident_key ?? data.id,
    occurredAt: toIso(event.occurred_at),
    raw: event,
  }
}

export function createPagerdutyAlertSource(): AlertSource<PagerdutyAlertConfig> {
  return {
    manifest: {
      id: 'pagerduty',
      name: 'PagerDuty',
      version: '0.1.0',
      sdkVersion: '0.2.0',
      kind: 'alert-source',
      description: 'Ingests PagerDuty webhook v3 incident notifications',
      configSchema: pagerdutyAlertConfigSchema,
      credentialSchema: pagerdutyAlertCredentialSchema,
    },
    async verify(req, config) {
      if (!config.signingSecret) return true
      const header = req.headers['x-pagerduty-signature']
      if (typeof header !== 'string' || header.length === 0) return false
      const expected = computeSignature(config.signingSecret, req.rawBody)
      const candidates = header
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.startsWith('v1='))
        .map((part) => part.slice(3))
      return candidates.some((candidate) => safeEqual(candidate, expected))
    },
    normalize(payload) {
      const body = pagerdutyWebhookPayloadSchema.parse(payload)
      if (!TRIGGERING_EVENT_TYPES.has(body.event.event_type)) return []
      return toNormalizedAlert(body.event)
    },
  }
}
