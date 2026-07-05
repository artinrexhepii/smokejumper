import { z } from 'zod'
import type { SourceContext, TelemetrySource, ToolSpec } from '@smokejumper/plugin-sdk'

export const dockerConfigSchema = z.object({ host: z.string().url() })

export type DockerConfig = z.infer<typeof dockerConfigSchema>

export function demuxDockerLogs(buf: Buffer): string {
  if (buf.length < 8) return buf.toString('utf8')
  const streamType = buf[0]!
  // multiplexed frames start with [type, 0, 0, 0, size be32]; tty output has no framing
  if (streamType > 2 || buf[1] !== 0 || buf[2] !== 0 || buf[3] !== 0) {
    return buf.toString('utf8')
  }
  const chunks: Buffer[] = []
  let offset = 0
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4)
    const start = offset + 8
    chunks.push(buf.subarray(start, Math.min(start + size, buf.length)))
    offset = start + size
  }
  return Buffer.concat(chunks).toString('utf8')
}

export interface DockerRawStats {
  cpu_stats: {
    cpu_usage: { total_usage: number }
    system_cpu_usage: number
    online_cpus?: number
  }
  precpu_stats: {
    cpu_usage: { total_usage: number }
    system_cpu_usage?: number
  }
  memory_stats: { usage?: number; limit?: number }
}

export interface ContainerStats {
  cpuPercent: number
  memoryUsageBytes: number
  memoryLimitBytes: number
  memoryPercent: number
}

export function computeContainerStats(raw: DockerRawStats): ContainerStats {
  const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage
  const systemDelta = raw.cpu_stats.system_cpu_usage - (raw.precpu_stats.system_cpu_usage ?? 0)
  const cpus = raw.cpu_stats.online_cpus ?? 1
  const cpuPercent = systemDelta > 0 && cpuDelta >= 0 ? (cpuDelta / systemDelta) * cpus * 100 : 0
  const usage = raw.memory_stats.usage ?? 0
  const limit = raw.memory_stats.limit ?? 0
  const memoryPercent = limit > 0 ? (usage / limit) * 100 : 0
  return {
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    memoryUsageBytes: usage,
    memoryLimitBytes: limit,
    memoryPercent: Math.round(memoryPercent * 100) / 100,
  }
}

async function dockerGet(ctx: SourceContext<DockerConfig>, path: string): Promise<Response> {
  const res = await ctx.fetch(`${ctx.config.host}${path}`, { signal: ctx.signal })
  if (!res.ok) throw new Error(`docker api returned ${res.status} for ${path}`)
  return res
}

const tools: ToolSpec<DockerConfig>[] = [
  {
    name: 'list_containers',
    description: 'List all Docker containers (running and stopped) with image, state, and status',
    inputSchema: z.object({}),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 300,
    async execute(_input, ctx) {
      const res = await dockerGet(ctx, '/containers/json?all=true')
      const containers = (await res.json()) as Array<{
        Id: string
        Names?: string[]
        Image: string
        State: string
        Status: string
      }>
      const data = containers.map((c) => ({
        id: c.Id.slice(0, 12),
        name: (c.Names?.[0] ?? '').replace(/^\//, ''),
        image: c.Image,
        state: c.State,
        status: c.Status,
      }))
      return { summary: `${data.length} containers`, data }
    },
  },
  {
    name: 'container_logs',
    description: 'Fetch recent log lines from a container (stdout and stderr, with timestamps)',
    inputSchema: z.object({
      container: z.string().min(1),
      tail: z.number().int().positive().max(1000).default(100),
    }),
    scope: 'read',
    costHint: 'moderate',
    latencyHintMs: 800,
    async execute(input, ctx) {
      const { container, tail } = input as { container: string; tail: number }
      const res = await dockerGet(
        ctx,
        `/containers/${encodeURIComponent(container)}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=1`,
      )
      const logs = demuxDockerLogs(Buffer.from(await res.arrayBuffer()))
      return { summary: `last ${tail} log lines of ${container}`, data: logs }
    },
  },
  {
    name: 'inspect_container',
    description: 'Inspect a container: state, restart count, OOM kills, health, image, mounts',
    inputSchema: z.object({ container: z.string().min(1) }),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 300,
    async execute(input, ctx) {
      const { container } = input as { container: string }
      const res = await dockerGet(ctx, `/containers/${encodeURIComponent(container)}/json`)
      const inspect = (await res.json()) as {
        Id: string
        RestartCount?: number
        Image: string
        Config?: { Image?: string }
        State?: {
          Status?: string
          OOMKilled?: boolean
          ExitCode?: number
          Health?: { Status?: string }
        }
        Mounts?: unknown[]
      }
      const data = {
        id: inspect.Id.slice(0, 12),
        state: inspect.State?.Status ?? 'unknown',
        oomKilled: inspect.State?.OOMKilled ?? false,
        exitCode: inspect.State?.ExitCode ?? 0,
        health: inspect.State?.Health?.Status ?? 'none',
        restartCount: inspect.RestartCount ?? 0,
        image: inspect.Config?.Image ?? inspect.Image,
        mounts: inspect.Mounts?.length ?? 0,
      }
      return {
        summary: `${container}: ${data.state}${data.oomKilled ? ' (OOMKilled)' : ''}, ${data.restartCount} restarts`,
        data,
      }
    },
  },
  {
    name: 'container_stats',
    description: 'One-shot CPU and memory usage for a container',
    inputSchema: z.object({ container: z.string().min(1) }),
    scope: 'read',
    costHint: 'moderate',
    latencyHintMs: 1500,
    async execute(input, ctx) {
      const { container } = input as { container: string }
      const res = await dockerGet(ctx, `/containers/${encodeURIComponent(container)}/stats?stream=false`)
      const stats = computeContainerStats((await res.json()) as DockerRawStats)
      return {
        summary: `${container}: cpu ${stats.cpuPercent}%, memory ${stats.memoryPercent}%`,
        data: stats,
      }
    },
  },
]

export function createDockerTelemetrySource(): TelemetrySource<DockerConfig> {
  return {
    manifest: {
      id: 'docker',
      name: 'Docker',
      version: '0.1.0',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source',
      description: 'Inspects containers, logs, and resource usage via the Docker Engine API',
      configSchema: dockerConfigSchema,
    },
    async healthCheck(ctx) {
      try {
        const res = await ctx.fetch(`${ctx.config.host}/_ping`, { signal: ctx.signal })
        return res.ok ? { ok: true } : { ok: false, message: `docker api returned ${res.status}` }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    tools() {
      return tools
    },
  }
}
