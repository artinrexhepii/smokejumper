import { z } from 'zod'

export const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'info'])

export type Severity = z.infer<typeof severitySchema>

export const normalizedAlertSchema = z.object({
  title: z.string().min(1),
  severity: severitySchema,
  service: z.string().min(1),
  labels: z.record(z.string()),
  dedupKey: z.string().min(1),
  occurredAt: z.string().datetime(),
  raw: z.unknown(),
})

export type NormalizedAlert = z.infer<typeof normalizedAlertSchema>
