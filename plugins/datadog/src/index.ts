import { z } from 'zod'
import type { SourceContext, TelemetrySource, ToolSpec } from '@smokejumper/plugin-sdk'

export const datadogConfigSchema = z.object({
  site: z.string().min(1),
})

export const datadogCredentialSchema = z.object({
  apiKey: z.string().min(1),
  appKey: z.string().min(1),
})

export type DatadogConfig = z.infer<typeof datadogConfigSchema> & z.infer<typeof datadogCredentialSchema>

interface DatadogMetricSeries {
  metric: string
  scope: string
  pointlist: [number, number][]
}

interface DatadogQueryResponse {
  status: string
  error?: string
  series: DatadogMetricSeries[]
}

interface DatadogLogEvent {
  id: string
  attributes: {
    timestamp: string
    message: string
    service?: string
    status?: string
    tags?: string[]
  }
}

interface DatadogLogsSearchResponse {
  data: DatadogLogEvent[]
}

interface DatadogMonitor {
  id: number
  name: string
  query: string
  overall_state: string
  tags: string[]
}

function apiBase(site: string): string {
  return `https://api.${site}`
}

function authHeaders(config: DatadogConfig): Record<string, string> {
  return { 'DD-API-KEY': config.apiKey, 'DD-APPLICATION-KEY': config.appKey }
}

async function datadogGet<T>(ctx: SourceContext<DatadogConfig>, path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, apiBase(ctx.config.site))
  if (params) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const res = await ctx.fetch(url, { signal: ctx.signal, headers: authHeaders(ctx.config) })
  if (!res.ok) throw new Error(`datadog returned ${res.status} for ${path}`)
  return (await res.json()) as T
}

async function datadogPost<T>(ctx: SourceContext<DatadogConfig>, path: string, body: unknown): Promise<T> {
  const url = new URL(path, apiBase(ctx.config.site))
  const res = await ctx.fetch(url, {
    method: 'POST',
    signal: ctx.signal,
    headers: { ...authHeaders(ctx.config), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`datadog returned ${res.status} for ${path}`)
  return (await res.json()) as T
}

const tools: ToolSpec<DatadogConfig>[] = [
  {
    name: 'list_metrics',
    description:
      'List Datadog metric names that have reported data recently, optionally filtered by a ' +
      'substring. Use this to discover the exact metric names before writing a query_metrics query ' +
      '— do not guess metric names.',
    inputSchema: z.object({
      contains: z.string().optional(),
      minutesAgo: z.number().int().positive().default(1440),
      limit: z.number().int().positive().max(1000).default(200),
    }),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 800,
    async execute(input, ctx) {
      const { contains, minutesAgo, limit } = input as {
        contains?: string
        minutesAgo: number
        limit: number
      }
      const from = Math.floor(Date.now() / 1000) - minutesAgo * 60
      const data = await datadogGet<{ metrics?: string[] }>(ctx, '/api/v1/metrics', { from: String(from) })
      const names = data.metrics ?? []
      const filtered = (contains ? names.filter((name) => name.includes(contains)) : names).slice(0, limit)
      return { summary: `${filtered.length} metrics`, data: filtered }
    },
  },
  {
    name: 'query_metrics',
    description: 'Run a Datadog metrics timeseries query over a recent time window',
    inputSchema: z.object({
      query: z.string().min(1),
      minutesAgo: z.number().int().positive().default(60),
    }),
    scope: 'read',
    costHint: 'moderate',
    latencyHintMs: 1000,
    async execute(input, ctx) {
      const { query, minutesAgo } = input as { query: string; minutesAgo: number }
      const to = Math.floor(Date.now() / 1000)
      const from = to - minutesAgo * 60
      const data = await datadogGet<DatadogQueryResponse>(ctx, '/api/v1/query', {
        query,
        from: String(from),
        to: String(to),
      })
      if (data.status !== 'ok') throw new Error(data.error ?? `datadog query "${query}" failed`)
      return { summary: `${query}: ${data.series.length} series over ${minutesAgo}m`, data: data.series }
    },
  },
  {
    name: 'search_logs',
    description: 'Search Datadog logs over a recent time window',
    inputSchema: z.object({
      query: z.string().min(1),
      minutesAgo: z.number().int().positive().default(60),
      limit: z.number().int().positive().max(1000).default(100),
    }),
    scope: 'read',
    costHint: 'moderate',
    latencyHintMs: 1500,
    async execute(input, ctx) {
      const { query, minutesAgo, limit } = input as { query: string; minutesAgo: number; limit: number }
      const data = await datadogPost<DatadogLogsSearchResponse>(ctx, '/api/v2/logs/events/search', {
        filter: { query, from: `now-${minutesAgo}m`, to: 'now' },
        sort: '-timestamp',
        page: { limit },
      })
      const events = data.data.map((event) => ({
        id: event.id,
        timestamp: event.attributes.timestamp,
        message: event.attributes.message,
        service: event.attributes.service ?? 'unknown',
        status: event.attributes.status ?? 'info',
        tags: event.attributes.tags ?? [],
      }))
      return { summary: `${events.length} log events for "${query}" over ${minutesAgo}m`, data: events }
    },
  },
  {
    name: 'list_monitors',
    description: 'List Datadog monitors and their current state',
    inputSchema: z.object({
      groupStates: z.enum(['alert', 'warn', 'no data', 'ok']).optional(),
      tags: z.string().optional(),
    }),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 500,
    async execute(input, ctx) {
      const { groupStates, tags } = input as { groupStates?: 'alert' | 'warn' | 'no data' | 'ok'; tags?: string }
      const params: Record<string, string> = {}
      if (groupStates) params.group_states = groupStates
      if (tags) params.monitor_tags = tags
      const data = await datadogGet<DatadogMonitor[]>(ctx, '/api/v1/monitor', params)
      const monitors = data.map((monitor) => ({
        id: monitor.id,
        name: monitor.name,
        query: monitor.query,
        overallState: monitor.overall_state,
        tags: monitor.tags,
      }))
      return { summary: `${monitors.length} monitors`, data: monitors }
    },
  },
]

export function createDatadogTelemetrySource(): TelemetrySource<DatadogConfig> {
  return {
    manifest: {
      id: 'datadog',
      name: 'Datadog',
      version: '0.1.0',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source',
      description: 'Queries metrics, logs, and monitors from Datadog',
      configSchema: datadogConfigSchema,
      credentialSchema: datadogCredentialSchema,
    },
    async healthCheck(ctx) {
      try {
        const res = await ctx.fetch(new URL('/api/v1/validate', apiBase(ctx.config.site)), {
          signal: ctx.signal,
          headers: authHeaders(ctx.config),
        })
        if (!res.ok) return { ok: false, message: `datadog returned ${res.status}` }
        const body = (await res.json()) as { valid?: boolean }
        return body.valid ? { ok: true } : { ok: false, message: 'datadog reported an invalid api key' }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    tools() {
      return tools
    },
  }
}
