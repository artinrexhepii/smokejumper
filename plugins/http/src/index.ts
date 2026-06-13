import { z } from 'zod'
import type { TelemetrySource } from '@smokejumper/plugin-sdk'

export const httpConfigSchema = z.object({})

export type HttpConfig = z.infer<typeof httpConfigSchema>

export function createHttpTelemetrySource(): TelemetrySource<HttpConfig> {
  return {
    manifest: {
      id: 'http',
      name: 'HTTP Check',
      version: '0.1.0',
      sdkVersion: '0.1.0',
      kind: 'telemetry-source',
      description: 'Probes HTTP endpoints for status and latency',
      configSchema: httpConfigSchema,
    },
    async healthCheck() {
      return { ok: true }
    },
    tools() {
      return [
        {
          name: 'http_check',
          description: 'GET a URL and report status, latency, and a body snippet',
          inputSchema: z.object({ url: z.string().url() }),
          scope: 'read',
          costHint: 'cheap',
          latencyHintMs: 1000,
          async execute(input, ctx) {
            const { url } = input as { url: string }
            const started = performance.now()
            try {
              const res = await ctx.fetch(url, { signal: ctx.signal })
              const body = await res.text()
              const latencyMs = Math.round(performance.now() - started)
              return {
                summary: `${url} responded ${res.status} in ${latencyMs}ms`,
                data: { status: res.status, ok: res.ok, latencyMs, bodySnippet: body.slice(0, 500) },
              }
            } catch (err) {
              const latencyMs = Math.round(performance.now() - started)
              return {
                summary: `${url} unreachable`,
                data: { ok: false, latencyMs, error: err instanceof Error ? err.message : String(err) },
              }
            }
          },
        },
      ]
    },
  }
}
