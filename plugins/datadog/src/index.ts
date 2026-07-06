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

const tools: ToolSpec<DatadogConfig>[] = [
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
