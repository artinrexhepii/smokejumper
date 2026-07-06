import { z } from 'zod'
import type { SourceContext, TelemetrySource, ToolSpec } from '@smokejumper/plugin-sdk'

export const prometheusConfigSchema = z.object({
  url: z.string().url(),
})

export const prometheusCredentialSchema = z.object({
  bearerToken: z.string().min(1).optional(),
  basicAuthUser: z.string().min(1).optional(),
  basicAuthPassword: z.string().min(1).optional(),
})

export type PrometheusConfig = z.infer<typeof prometheusConfigSchema> & z.infer<typeof prometheusCredentialSchema>

interface PrometheusApiResponse<T> {
  status: 'success' | 'error'
  data: T
  error?: string
  errorType?: string
}

function authHeaders(config: PrometheusConfig): Record<string, string> {
  if (config.bearerToken) return { authorization: `Bearer ${config.bearerToken}` }
  if (config.basicAuthUser && config.basicAuthPassword) {
    const encoded = Buffer.from(`${config.basicAuthUser}:${config.basicAuthPassword}`, 'utf8').toString('base64')
    return { authorization: `Basic ${encoded}` }
  }
  return {}
}

async function prometheusGet<T>(
  ctx: SourceContext<PrometheusConfig>,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(path, ctx.config.url)
  if (params) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const res = await ctx.fetch(url, { signal: ctx.signal, headers: authHeaders(ctx.config) })
  if (!res.ok) throw new Error(`prometheus returned ${res.status} for ${path}`)
  const body = (await res.json()) as PrometheusApiResponse<T>
  if (body.status !== 'success') throw new Error(body.error ?? `prometheus request to ${path} failed`)
  return body.data
}

const tools: ToolSpec<PrometheusConfig>[] = [
  {
    name: 'instant_query',
    description: 'Run a PromQL instant query',
    inputSchema: z.object({ query: z.string().min(1) }),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 500,
    async execute(input, ctx) {
      const { query } = input as { query: string }
      const data = await prometheusGet<{ resultType: string; result: unknown[] }>(ctx, '/api/v1/query', { query })
      return { summary: `${query}: ${data.result.length} results`, data }
    },
  },
  {
    name: 'range_query',
    description: 'Run a PromQL range query over a recent time window',
    inputSchema: z.object({
      query: z.string().min(1),
      minutesAgo: z.number().int().positive().default(60),
      stepSeconds: z.number().int().positive().default(60),
    }),
    scope: 'read',
    costHint: 'moderate',
    latencyHintMs: 1500,
    async execute(input, ctx) {
      const { query, minutesAgo, stepSeconds } = input as { query: string; minutesAgo: number; stepSeconds: number }
      const end = Math.floor(Date.now() / 1000)
      const start = end - minutesAgo * 60
      const data = await prometheusGet<{ resultType: string; result: unknown[] }>(ctx, '/api/v1/query_range', {
        query,
        start: String(start),
        end: String(end),
        step: String(stepSeconds),
      })
      return { summary: `${query}: ${data.result.length} series over ${minutesAgo}m`, data }
    },
  },
  {
    name: 'list_alerts',
    description: 'List active Prometheus alerts',
    inputSchema: z.object({}),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 500,
    async execute(_input, ctx) {
      const data = await prometheusGet<{
        alerts: Array<{ labels: Record<string, string>; state: string; activeAt: string }>
      }>(ctx, '/api/v1/alerts')
      return { summary: `${data.alerts.length} active alerts`, data: data.alerts }
    },
  },
  {
    name: 'list_targets',
    description: 'List Prometheus scrape targets and their health',
    inputSchema: z.object({ state: z.enum(['active', 'dropped', 'any']).default('any') }),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 500,
    async execute(input, ctx) {
      const { state } = input as { state: 'active' | 'dropped' | 'any' }
      const data = await prometheusGet<{ activeTargets: unknown[]; droppedTargets: unknown[] }>(
        ctx,
        '/api/v1/targets',
        state === 'any' ? undefined : { state },
      )
      return { summary: `${data.activeTargets.length} active, ${data.droppedTargets.length} dropped targets`, data }
    },
  },
]

export function createPrometheusTelemetrySource(): TelemetrySource<PrometheusConfig> {
  return {
    manifest: {
      id: 'prometheus',
      name: 'Prometheus',
      version: '0.1.0',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source',
      description: 'Queries metrics, alerts, and scrape targets from a Prometheus server',
      configSchema: prometheusConfigSchema,
      credentialSchema: prometheusCredentialSchema,
    },
    async healthCheck(ctx) {
      try {
        const res = await ctx.fetch(new URL('/-/healthy', ctx.config.url), { signal: ctx.signal, headers: authHeaders(ctx.config) })
        if (res.ok) return { ok: true }
        const fallback = await ctx.fetch(new URL('/api/v1/status/buildinfo', ctx.config.url), {
          signal: ctx.signal,
          headers: authHeaders(ctx.config),
        })
        return fallback.ok ? { ok: true } : { ok: false, message: `prometheus returned ${res.status}` }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    tools() {
      return tools
    },
  }
}
