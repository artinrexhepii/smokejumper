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
