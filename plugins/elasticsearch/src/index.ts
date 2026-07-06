import { z } from 'zod'
import type { SourceContext, TelemetrySource, ToolSpec } from '@smokejumper/plugin-sdk'

export const elasticsearchConfigSchema = z.object({
  url: z.string().url(),
  indexPattern: z.string().min(1),
})

export const elasticsearchCredentialSchema = z.object({
  apiKey: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
})

export type ElasticsearchConfig = z.infer<typeof elasticsearchConfigSchema> & z.infer<typeof elasticsearchCredentialSchema>

export interface EsHit {
  _index: string
  _id: string
  _source: Record<string, unknown>
}

export interface EsLogEntry {
  timestamp: string
  index: string
  id: string
  source: Record<string, unknown>
}

export function flattenEsHits(hits: EsHit[]): EsLogEntry[] {
  return hits.map((hit) => ({
    timestamp: typeof hit._source['@timestamp'] === 'string' ? (hit._source['@timestamp'] as string) : new Date(0).toISOString(),
    index: hit._index,
    id: hit._id,
    source: hit._source,
  }))
}

interface EsSearchResponse {
  hits: {
    total: { value: number; relation: string }
    hits: EsHit[]
  }
}

export interface EsCatIndex {
  health: string
  status: string
  index: string
  'docs.count': string
  'store.size': string
}

interface EsClusterHealth {
  cluster_name: string
  status: 'green' | 'yellow' | 'red'
}

function authHeaders(config: ElasticsearchConfig): Record<string, string> {
  if (config.apiKey) return { authorization: `ApiKey ${config.apiKey}` }
  if (config.username && config.password) {
    const encoded = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')
    return { authorization: `Basic ${encoded}` }
  }
  return {}
}

async function esGet<T>(ctx: SourceContext<ElasticsearchConfig>, path: string): Promise<T> {
  const url = new URL(path, ctx.config.url)
  const res = await ctx.fetch(url, { signal: ctx.signal, headers: authHeaders(ctx.config) })
  if (!res.ok) throw new Error(`elasticsearch returned ${res.status} for ${path}`)
  return (await res.json()) as T
}

async function esPost<T>(ctx: SourceContext<ElasticsearchConfig>, path: string, body: unknown): Promise<T> {
  const url = new URL(path, ctx.config.url)
  const res = await ctx.fetch(url, {
    method: 'POST',
    signal: ctx.signal,
    headers: { 'content-type': 'application/json', ...authHeaders(ctx.config) },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`elasticsearch returned ${res.status} for ${path}`)
  return (await res.json()) as T
}

const tools: ToolSpec<ElasticsearchConfig>[] = [
  {
    name: 'search_logs',
    description: 'Search logs in the configured index pattern within a recent time window',
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
      const now = Date.now()
      const gte = new Date(now - minutesAgo * 60_000).toISOString()
      const lte = new Date(now).toISOString()
      const body = {
        query: {
          bool: {
            must: [{ query_string: { query } }],
            filter: [{ range: { '@timestamp': { gte, lte } } }],
          },
        },
        sort: [{ '@timestamp': 'desc' }],
        size: limit,
      }
      const data = await esPost<EsSearchResponse>(ctx, `/${ctx.config.indexPattern}/_search`, body)
      const entries = flattenEsHits(data.hits.hits)
      return { summary: `${query}: ${entries.length} log lines over ${minutesAgo}m`, data: entries }
    },
  },
  {
    name: 'list_indices',
    description: 'List indices matching the configured index pattern',
    inputSchema: z.object({}),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 500,
    async execute(_input, ctx) {
      const data = await esGet<EsCatIndex[]>(ctx, `/_cat/indices/${encodeURIComponent(ctx.config.indexPattern)}?format=json`)
      return { summary: `${data.length} indices matching "${ctx.config.indexPattern}"`, data }
    },
  },
]

export function createElasticsearchTelemetrySource(): TelemetrySource<ElasticsearchConfig> {
  return {
    manifest: {
      id: 'elasticsearch',
      name: 'Elasticsearch',
      version: '0.1.0',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source',
      description: 'Searches logs from an Elasticsearch or OpenSearch index pattern',
      configSchema: elasticsearchConfigSchema,
      credentialSchema: elasticsearchCredentialSchema,
    },
    async healthCheck(ctx) {
      try {
        const res = await ctx.fetch(new URL('/_cluster/health', ctx.config.url), { signal: ctx.signal, headers: authHeaders(ctx.config) })
        if (!res.ok) return { ok: false, message: `elasticsearch returned ${res.status}` }
        const body = (await res.json()) as EsClusterHealth
        return body.status === 'red' ? { ok: false, message: 'cluster status is red' } : { ok: true }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    tools() {
      return tools
    },
  }
}
