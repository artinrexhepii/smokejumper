import { z } from 'zod'
import type { SourceContext, TelemetrySource, ToolSpec } from '@smokejumper/plugin-sdk'

export const lokiConfigSchema = z.object({
  url: z.string().url(),
  tenantId: z.string().min(1).optional(),
})

export const lokiCredentialSchema = z.object({
  bearerToken: z.string().min(1).optional(),
  basicAuthUser: z.string().min(1).optional(),
  basicAuthPassword: z.string().min(1).optional(),
})

export type LokiConfig = z.infer<typeof lokiConfigSchema> & z.infer<typeof lokiCredentialSchema>

export interface LokiStream {
  stream: Record<string, string>
  values: [string, string][]
}

export interface LokiLine {
  timestamp: string
  line: string
  labels: Record<string, string>
}

export function flattenLokiStreams(streams: LokiStream[]): LokiLine[] {
  const lines = streams.flatMap((stream) =>
    stream.values.map(([ts, line]) => ({
      timestamp: new Date(Number(BigInt(ts) / 1_000_000n)).toISOString(),
      line,
      labels: stream.stream,
    })),
  )
  return lines.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

function authHeaders(config: LokiConfig): Record<string, string> {
  const headers: Record<string, string> = {}
  if (config.bearerToken) headers.authorization = `Bearer ${config.bearerToken}`
  else if (config.basicAuthUser && config.basicAuthPassword) {
    const encoded = Buffer.from(`${config.basicAuthUser}:${config.basicAuthPassword}`, 'utf8').toString('base64')
    headers.authorization = `Basic ${encoded}`
  }
  if (config.tenantId) headers['X-Scope-OrgID'] = config.tenantId
  return headers
}

function nsWindow(minutesAgo: number): { start: string; end: string } {
  const endNs = BigInt(Date.now()) * 1_000_000n
  const startNs = endNs - BigInt(minutesAgo * 60) * 1_000_000_000n
  return { start: startNs.toString(), end: endNs.toString() }
}

async function lokiGet<T>(ctx: SourceContext<LokiConfig>, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, ctx.config.url)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const res = await ctx.fetch(url, { signal: ctx.signal, headers: authHeaders(ctx.config) })
  if (!res.ok) throw new Error(`loki returned ${res.status} for ${path}`)
  const body = (await res.json()) as { status: string; data: T }
  if (body.status !== 'success') throw new Error(`loki request to ${path} failed`)
  return body.data
}

const tools: ToolSpec<LokiConfig>[] = [
  {
    name: 'query_range',
    description: 'Run a LogQL range query and return matching log lines',
    inputSchema: z.object({
      query: z.string().min(1),
      minutesAgo: z.number().int().positive().default(60),
      limit: z.number().int().positive().max(5000).default(100),
    }),
    scope: 'read',
    costHint: 'moderate',
    latencyHintMs: 1500,
    async execute(input, ctx) {
      const { query, minutesAgo, limit } = input as { query: string; minutesAgo: number; limit: number }
      const { start, end } = nsWindow(minutesAgo)
      const data = await lokiGet<{ resultType: string; result: LokiStream[] }>(ctx, '/loki/api/v1/query_range', {
        query,
        start,
        end,
        limit: String(limit),
      })
      const lines = flattenLokiStreams(data.result)
      return { summary: `${query}: ${lines.length} log lines over ${minutesAgo}m`, data: lines }
    },
  },
  {
    name: 'labels',
    description: 'List all known Loki label names over a recent time window',
    inputSchema: z.object({ minutesAgo: z.number().int().positive().default(60) }),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 500,
    async execute(input, ctx) {
      const { minutesAgo } = input as { minutesAgo: number }
      const { start, end } = nsWindow(minutesAgo)
      const data = await lokiGet<string[]>(ctx, '/loki/api/v1/labels', { start, end })
      return { summary: `${data.length} labels`, data }
    },
  },
  {
    name: 'label_values',
    description: 'List known values for a Loki label over a recent time window',
    inputSchema: z.object({ label: z.string().min(1), minutesAgo: z.number().int().positive().default(60) }),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 500,
    async execute(input, ctx) {
      const { label, minutesAgo } = input as { label: string; minutesAgo: number }
      const { start, end } = nsWindow(minutesAgo)
      const data = await lokiGet<string[]>(ctx, `/loki/api/v1/label/${encodeURIComponent(label)}/values`, { start, end })
      return { summary: `${data.length} values for label "${label}"`, data }
    },
  },
]

export function createLokiTelemetrySource(): TelemetrySource<LokiConfig> {
  return {
    manifest: {
      id: 'loki',
      name: 'Loki',
      version: '0.1.0',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source',
      description: 'Queries logs from a Grafana Loki server via LogQL',
      configSchema: lokiConfigSchema,
      credentialSchema: lokiCredentialSchema,
    },
    async healthCheck(ctx) {
      try {
        const res = await ctx.fetch(new URL('/ready', ctx.config.url), { signal: ctx.signal, headers: authHeaders(ctx.config) })
        return res.ok ? { ok: true } : { ok: false, message: `loki returned ${res.status}` }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    tools() {
      return tools
    },
  }
}
