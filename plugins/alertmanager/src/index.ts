import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { AlertSource, NormalizedAlert, Severity } from '@smokejumper/plugin-sdk'

export const alertmanagerConfigSchema = z.object({
  severityLabel: z.string().min(1).default('severity'),
})

export const alertmanagerCredentialSchema = z.object({
  token: z.string().min(1).optional(),
})

export type AlertmanagerConfig = z.infer<typeof alertmanagerConfigSchema> & z.infer<typeof alertmanagerCredentialSchema>

const alertmanagerAlertSchema = z.object({
  status: z.enum(['firing', 'resolved']),
  labels: z.record(z.string()),
  annotations: z.record(z.string()).default({}),
  startsAt: z.string(),
  endsAt: z.string().optional(),
  generatorURL: z.string().optional(),
  fingerprint: z.string().optional(),
})

export const alertmanagerWebhookSchema = z.object({
  version: z.string().optional(),
  groupKey: z.string().optional(),
  truncatedAlerts: z.number().optional(),
  status: z.enum(['firing', 'resolved']).optional(),
  receiver: z.string().optional(),
  groupLabels: z.record(z.string()).optional(),
  commonLabels: z.record(z.string()).optional(),
  commonAnnotations: z.record(z.string()).optional(),
  externalURL: z.string().optional(),
  alerts: z.array(alertmanagerAlertSchema),
})

type AlertmanagerAlert = z.infer<typeof alertmanagerAlertSchema>

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function mapSeverity(raw: string | undefined): Severity {
  switch (raw?.toLowerCase()) {
    case 'critical':
      return 'critical'
    case 'page':
    case 'error':
      return 'high'
    case 'warning':
    case 'warn':
      return 'medium'
    case 'info':
      return 'low'
    default:
      return 'medium'
  }
}

function toIso(value: string): string {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString()
}

function toNormalizedAlert(alert: AlertmanagerAlert, severityLabel: string): NormalizedAlert {
  const { labels, annotations } = alert
  const title = annotations.summary || annotations.description || labels.alertname || 'alert'
  const service = labels.service || labels.job || labels.namespace || labels.alertname || 'unknown'
  const dedupKey = alert.fingerprint ?? `${labels.alertname ?? 'unknown'}:${service}`
  return {
    title,
    severity: mapSeverity(labels[severityLabel]),
    service,
    labels,
    dedupKey,
    occurredAt: toIso(alert.startsAt),
    raw: alert,
  }
}

export function createAlertmanagerAlertSource(): AlertSource<AlertmanagerConfig> {
  return {
    manifest: {
      id: 'alertmanager',
      name: 'Alertmanager',
      version: '0.1.0',
      sdkVersion: '0.2.0',
      kind: 'alert-source',
      description: 'Ingests Prometheus Alertmanager webhook notifications',
      configSchema: alertmanagerConfigSchema,
      credentialSchema: alertmanagerCredentialSchema,
    },
    async verify(req, config) {
      if (!config.token) return true
      const header = req.headers['authorization']
      if (typeof header !== 'string') return false
      return safeEqual(header, `Bearer ${config.token}`)
    },
    normalize(payload, config) {
      const body = alertmanagerWebhookSchema.parse(payload)
      return body.alerts.filter((alert) => alert.status === 'firing').map((alert) => toNormalizedAlert(alert, config.severityLabel))
    },
  }
}
