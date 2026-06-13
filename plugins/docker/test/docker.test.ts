import { describe, expect, it } from 'vitest'
import { checkTelemetrySource, type SourceContext, type ToolContext } from '@smokejumper/plugin-sdk'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import {
  computeContainerStats,
  createDockerTelemetrySource,
  demuxDockerLogs,
  type DockerConfig,
} from '../src/index'

const source = createDockerTelemetrySource()

function frame(stream: number, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const header = Buffer.alloc(8)
  header.writeUInt8(stream, 0)
  header.writeUInt32BE(payload.length, 4)
  return Buffer.concat([header, payload])
}

const containerList = [
  { Id: 'a1b2c3d4e5f6a7b8', Names: ['/shop-api'], Image: 'shop-api:latest', State: 'running', Status: 'Up 2 hours' },
  {
    Id: 'ffeeddccbbaa00991122334455667788',
    Names: ['/worker'],
    Image: 'worker:latest',
    State: 'exited',
    Status: 'Exited (137) 5 minutes ago',
  },
]

const inspectPayload = {
  Id: 'ffeeddccbbaa00991122334455667788',
  RestartCount: 3,
  Image: 'sha256:abc123',
  Config: { Image: 'worker:latest' },
  State: { Status: 'exited', OOMKilled: true, ExitCode: 137, Health: { Status: 'unhealthy' } },
  Mounts: [{}, {}],
}

const statsPayload = {
  cpu_stats: { cpu_usage: { total_usage: 400_000_000 }, system_cpu_usage: 2_000_000_000, online_cpus: 2 },
  precpu_stats: { cpu_usage: { total_usage: 200_000_000 }, system_cpu_usage: 1_000_000_000 },
  memory_stats: { usage: 104_857_600, limit: 209_715_200 },
}

function fakeDockerFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const { pathname } = new URL(String(input))
    if (pathname === '/_ping') return new Response('OK')
    if (pathname === '/containers/json') return Response.json(containerList)
    if (pathname === '/containers/worker/logs') {
      return new Response(Buffer.concat([frame(1, 'listening on :4000\n'), frame(2, 'FATAL: out of memory\n')]))
    }
    if (pathname === '/containers/worker/json') return Response.json(inspectPayload)
    if (pathname === '/containers/worker/stats') return Response.json(statsPayload)
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

function makeContext(): SourceContext<DockerConfig> {
  return { ...createTestContext<DockerConfig>({ host: 'http://docker.test' }), fetch: fakeDockerFetch() }
}

function makeToolContext(): ToolContext<DockerConfig> {
  return { ...makeContext(), incidentId: 'inc-1' }
}

const tool = (name: string) => source.tools().find((t) => t.name === name)!

describe('demuxDockerLogs', () => {
  it('strips multiplexed frame headers', () => {
    const buf = Buffer.concat([frame(1, 'line one\n'), frame(2, 'line two\n')])
    expect(demuxDockerLogs(buf)).toBe('line one\nline two\n')
  })

  it('passes through non-multiplexed tty output', () => {
    expect(demuxDockerLogs(Buffer.from('plain tty log line\n'))).toBe('plain tty log line\n')
    expect(demuxDockerLogs(Buffer.from('hi'))).toBe('hi')
  })

  it('tolerates a truncated final frame', () => {
    const truncated = frame(2, 'partial').subarray(0, 8 + 3)
    expect(demuxDockerLogs(Buffer.concat([frame(1, 'complete\n'), truncated]))).toBe('complete\npar')
  })
})

describe('computeContainerStats', () => {
  it('computes cpu and memory percentages from deltas', () => {
    expect(computeContainerStats(statsPayload)).toEqual({
      cpuPercent: 40,
      memoryUsageBytes: 104_857_600,
      memoryLimitBytes: 209_715_200,
      memoryPercent: 50,
    })
  })

  it('returns zero cpu when there is no system delta', () => {
    const idle = {
      ...statsPayload,
      precpu_stats: { cpu_usage: { total_usage: 400_000_000 }, system_cpu_usage: 2_000_000_000 },
    }
    expect(computeContainerStats(idle).cpuPercent).toBe(0)
  })
})

describe('docker telemetry source', () => {
  it('passes conformance', async () => {
    const result = await checkTelemetrySource(source, makeContext())
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('lists containers with short ids and clean names', async () => {
    const t = tool('list_containers')
    const result = await t.execute(t.inputSchema.parse({}), makeToolContext())
    expect(result.summary).toBe('2 containers')
    expect(result.data).toEqual([
      { id: 'a1b2c3d4e5f6', name: 'shop-api', image: 'shop-api:latest', state: 'running', status: 'Up 2 hours' },
      { id: 'ffeeddccbbaa', name: 'worker', image: 'worker:latest', state: 'exited', status: 'Exited (137) 5 minutes ago' },
    ])
  })

  it('fetches and demultiplexes container logs', async () => {
    const t = tool('container_logs')
    const result = await t.execute(t.inputSchema.parse({ container: 'worker' }), makeToolContext())
    expect(result.data).toBe('listening on :4000\nFATAL: out of memory\n')
    expect(result.summary).toContain('100')
  })

  it('inspects a container', async () => {
    const t = tool('inspect_container')
    const result = await t.execute(t.inputSchema.parse({ container: 'worker' }), makeToolContext())
    expect(result.data).toEqual({
      id: 'ffeeddccbbaa',
      state: 'exited',
      oomKilled: true,
      exitCode: 137,
      health: 'unhealthy',
      restartCount: 3,
      image: 'worker:latest',
      mounts: 2,
    })
    expect(result.summary).toContain('OOMKilled')
  })

  it('reports one-shot container stats', async () => {
    const t = tool('container_stats')
    const result = await t.execute(t.inputSchema.parse({ container: 'worker' }), makeToolContext())
    expect(result.summary).toBe('worker: cpu 40%, memory 50%')
    expect((result.data as { cpuPercent: number }).cpuPercent).toBe(40)
  })

  it('reports unhealthy when the docker api is unreachable', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const health = await source.healthCheck({ ...createTestContext<DockerConfig>({ host: 'http://docker.test' }), fetch: failing })
    expect(health.ok).toBe(false)
    expect(health.message).toBe('fetch failed')
  })
})
