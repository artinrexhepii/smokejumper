import { z } from 'zod'
import type { SourceContext, TelemetrySource, ToolSpec } from '@smokejumper/plugin-sdk'

export const grafanaConfigSchema = z.object({
  url: z.string().url(),
})

export const grafanaCredentialSchema = z.object({
  apiToken: z.string().min(1),
})

export type GrafanaConfig = z.infer<typeof grafanaConfigSchema> & z.infer<typeof grafanaCredentialSchema>

export interface GrafanaDatasource {
  id: number
  uid: string
  name: string
  type: string
  url: string
  isDefault: boolean
}

export interface GrafanaAnnotation {
  id: number
  alertId?: number
  dashboardId?: number
  panelId?: number
  userId?: number
  time: number
  timeEnd?: number
  text: string
  tags: string[]
}

interface GrafanaProxyQueryResponse {
  status: 'success' | 'error'
  data: { resultType: string; result: unknown[] }
  error?: string
}

function authHeaders(config: GrafanaConfig): Record<string, string> {
  return { authorization: `Bearer ${config.apiToken}` }
}

async function grafanaGet<T>(
  ctx: SourceContext<GrafanaConfig>,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(path, ctx.config.url)
  if (params) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const res = await ctx.fetch(url, { signal: ctx.signal, headers: authHeaders(ctx.config) })
  if (!res.ok) throw new Error(`grafana returned ${res.status} for ${path}`)
  return (await res.json()) as T
}

const tools: ToolSpec<GrafanaConfig>[] = [
  {
    name: 'list_datasources',
    description: 'List datasources configured in Grafana',
    inputSchema: z.object({}),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 500,
    async execute(_input, ctx) {
      const data = await grafanaGet<GrafanaDatasource[]>(ctx, '/api/datasources')
      return { summary: `${data.length} datasources`, data }
    },
  },
  {
    name: 'query_datasource',
    description: 'Run a range query against a Grafana datasource through its datasource-proxy endpoint',
    inputSchema: z.object({
      datasourceId: z.number().int().positive(),
      query: z.string().min(1),
      minutesAgo: z.number().int().positive().default(60),
      stepSeconds: z.number().int().positive().default(60),
    }),
    scope: 'read',
    costHint: 'moderate',
    latencyHintMs: 1500,
    async execute(input, ctx) {
      const { datasourceId, query, minutesAgo, stepSeconds } = input as {
        datasourceId: number
        query: string
        minutesAgo: number
        stepSeconds: number
      }
      const end = Math.floor(Date.now() / 1000)
      const start = end - minutesAgo * 60
      const data = await grafanaGet<GrafanaProxyQueryResponse>(
        ctx,
        `/api/datasources/proxy/${datasourceId}/api/v1/query_range`,
        { query, start: String(start), end: String(end), step: String(stepSeconds) },
      )
      if (data.status !== 'success') throw new Error(data.error ?? `datasource ${datasourceId} query failed`)
      return {
        summary: `${query}: ${data.data.result.length} series over ${minutesAgo}m via datasource ${datasourceId}`,
        data: data.data,
      }
    },
  },
  {
    name: 'search_annotations',
    description: 'Search Grafana annotations (deploys, alerts, manual notes) within a recent time window',
    inputSchema: z.object({
      minutesAgo: z.number().int().positive().default(60),
      limit: z.number().int().positive().max(1000).default(100),
      tags: z.array(z.string()).optional(),
    }),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 500,
    async execute(input, ctx) {
      const { minutesAgo, limit, tags } = input as { minutesAgo: number; limit: number; tags?: string[] }
      const to = Date.now()
      const from = to - minutesAgo * 60_000
      const url = new URL('/api/annotations', ctx.config.url)
      url.searchParams.set('from', String(from))
      url.searchParams.set('to', String(to))
      url.searchParams.set('limit', String(limit))
      if (tags) for (const tagValue of tags) url.searchParams.append('tags', tagValue)
      const res = await ctx.fetch(url, { signal: ctx.signal, headers: authHeaders(ctx.config) })
      if (!res.ok) throw new Error(`grafana returned ${res.status} for /api/annotations`)
      const data = (await res.json()) as GrafanaAnnotation[]
      return { summary: `${data.length} annotations over ${minutesAgo}m`, data }
    },
  },
]

export function createGrafanaTelemetrySource(): TelemetrySource<GrafanaConfig> {
  return {
    manifest: {
      id: 'grafana',
      name: 'Grafana',
      version: '0.1.0',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source',
      description: 'Queries datasources and annotations from a Grafana instance',
      configSchema: grafanaConfigSchema,
      credentialSchema: grafanaCredentialSchema,
    },
    async healthCheck(ctx) {
      try {
        const res = await ctx.fetch(new URL('/api/health', ctx.config.url), { signal: ctx.signal, headers: authHeaders(ctx.config) })
        if (!res.ok) return { ok: false, message: `grafana returned ${res.status}` }
        const body = (await res.json()) as { database?: string }
        return body.database === 'ok' ? { ok: true } : { ok: false, message: `grafana database status is "${body.database}"` }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    tools() {
      return tools
    },
  }
}
