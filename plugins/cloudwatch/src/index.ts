import { z } from 'zod'
import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  GetMetricStatisticsCommand,
  type Datapoint,
} from '@aws-sdk/client-cloudwatch'
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  GetQueryResultsCommand,
  StartQueryCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import type { TelemetrySource, ToolSpec } from '@smokejumper/plugin-sdk'

export const cloudwatchConfigSchema = z.object({
  region: z.string().min(1),
})

export const cloudwatchCredentialSchema = z.object({
  accessKeyId: z.string().min(1).optional(),
  secretAccessKey: z.string().min(1).optional(),
  sessionToken: z.string().min(1).optional(),
})

export type CloudwatchConfig = z.infer<typeof cloudwatchConfigSchema> &
  z.infer<typeof cloudwatchCredentialSchema>

const POLL_INTERVAL_MS = 500
const TERMINAL_QUERY_STATUSES = new Set(['Complete', 'Failed', 'Cancelled', 'Timeout'])

function resolveCredentials(config: CloudwatchConfig) {
  if (config.accessKeyId && config.secretAccessKey) {
    return {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
    }
  }
  return fromNodeProviderChain()
}

function cloudwatchClient(config: CloudwatchConfig): CloudWatchClient {
  return new CloudWatchClient({ region: config.region, credentials: resolveCredentials(config) })
}

function logsClient(config: CloudwatchConfig): CloudWatchLogsClient {
  return new CloudWatchLogsClient({ region: config.region, credentials: resolveCredentials(config) })
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('aborted')
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function datapointValue(point: Datapoint, stat: string): number | null {
  switch (stat) {
    case 'Average':
      return point.Average ?? null
    case 'Sum':
      return point.Sum ?? null
    case 'Maximum':
      return point.Maximum ?? null
    case 'Minimum':
      return point.Minimum ?? null
    case 'p99':
      return point.ExtendedStatistics?.p99 ?? null
    default:
      return null
  }
}

const tools: ToolSpec<CloudwatchConfig>[] = [
  {
    name: 'describe_alarms',
    description: 'List CloudWatch alarms with their state, metric, threshold, and last state reason',
    inputSchema: z.object({
      stateValue: z.enum(['OK', 'ALARM', 'INSUFFICIENT_DATA']).optional(),
      alarmNamePrefix: z.string().optional(),
    }),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 500,
    async execute(input, ctx) {
      const { stateValue, alarmNamePrefix } = input as {
        stateValue?: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA'
        alarmNamePrefix?: string
      }
      const client = cloudwatchClient(ctx.config)
      const res = await client.send(
        new DescribeAlarmsCommand({ StateValue: stateValue, AlarmNamePrefix: alarmNamePrefix, MaxRecords: 100 }),
        { abortSignal: ctx.signal },
      )
      const data = (res.MetricAlarms ?? []).map((alarm) => ({
        name: alarm.AlarmName ?? '',
        state: alarm.StateValue ?? 'INSUFFICIENT_DATA',
        metric: alarm.MetricName ?? '',
        namespace: alarm.Namespace ?? '',
        threshold: alarm.Threshold ?? null,
        comparison: alarm.ComparisonOperator ?? '',
        reason: alarm.StateReason ?? '',
      }))
      return { summary: `${data.length} alarms`, data }
    },
  },
  {
    name: 'get_metric_statistics',
    description: 'Fetch aggregated datapoints for a CloudWatch metric over a recent time window',
    inputSchema: z.object({
      namespace: z.string().min(1),
      metricName: z.string().min(1),
      dimensions: z.record(z.string()).optional(),
      stat: z.enum(['Average', 'Sum', 'Maximum', 'Minimum', 'p99']).default('Average'),
      periodSeconds: z.number().int().positive().default(300),
      minutesAgo: z.number().int().positive().default(60),
    }),
    scope: 'read',
    costHint: 'moderate',
    latencyHintMs: 800,
    async execute(input, ctx) {
      const { namespace, metricName, dimensions, stat, periodSeconds, minutesAgo } = input as {
        namespace: string
        metricName: string
        dimensions?: Record<string, string>
        stat: 'Average' | 'Sum' | 'Maximum' | 'Minimum' | 'p99'
        periodSeconds: number
        minutesAgo: number
      }
      const client = cloudwatchClient(ctx.config)
      const endTime = new Date()
      const startTime = new Date(endTime.getTime() - minutesAgo * 60_000)
      const isExtended = stat === 'p99'
      const res = await client.send(
        new GetMetricStatisticsCommand({
          Namespace: namespace,
          MetricName: metricName,
          Dimensions: Object.entries(dimensions ?? {}).map(([Name, Value]) => ({ Name, Value })),
          StartTime: startTime,
          EndTime: endTime,
          Period: periodSeconds,
          Statistics: isExtended ? undefined : [stat],
          ExtendedStatistics: isExtended ? ['p99'] : undefined,
        }),
        { abortSignal: ctx.signal },
      )
      const data = (res.Datapoints ?? [])
        .map((point) => ({
          timestamp: point.Timestamp?.toISOString() ?? '',
          value: datapointValue(point, stat),
          unit: point.Unit ?? '',
        }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      return { summary: `${data.length} datapoints for ${namespace}/${metricName}`, data }
    },
  },
  {
    name: 'query_logs_insights',
    description: 'Run a CloudWatch Logs Insights query and return the result rows',
    inputSchema: z.object({
      logGroup: z.string().min(1),
      query: z.string().min(1),
      minutesAgo: z.number().int().positive().default(30),
      limit: z.number().int().positive().max(10_000).default(100),
    }),
    scope: 'read',
    costHint: 'expensive',
    latencyHintMs: 5000,
    async execute(input, ctx) {
      const { logGroup, query, minutesAgo, limit } = input as {
        logGroup: string
        query: string
        minutesAgo: number
        limit: number
      }
      const client = logsClient(ctx.config)
      const endSeconds = Math.floor(Date.now() / 1000)
      const startSeconds = endSeconds - minutesAgo * 60
      const started = await client.send(
        new StartQueryCommand({
          logGroupName: logGroup,
          queryString: query,
          startTime: startSeconds,
          endTime: endSeconds,
          limit,
        }),
        { abortSignal: ctx.signal },
      )
      const queryId = started.queryId
      if (!queryId) throw new Error('cloudwatch logs did not return a query id')
      for (;;) {
        if (ctx.signal.aborted) throw abortError(ctx.signal)
        const out = await client.send(new GetQueryResultsCommand({ queryId }), { abortSignal: ctx.signal })
        const status = out.status ?? 'Running'
        if (TERMINAL_QUERY_STATUSES.has(status)) {
          if (status !== 'Complete') throw new Error(`logs insights query ${status}`)
          const rows = (out.results ?? []).map((row) => {
            const record: Record<string, string> = {}
            for (const cell of row) {
              if (cell.field) record[cell.field] = cell.value ?? ''
            }
            return record
          })
          return { summary: `${rows.length} rows`, data: rows }
        }
        await delay(POLL_INTERVAL_MS, ctx.signal)
      }
    },
  },
  {
    name: 'get_log_events',
    description: 'Fetch recent CloudWatch log events from a log group, optionally filtered by a pattern',
    inputSchema: z.object({
      logGroup: z.string().min(1),
      filterPattern: z.string().optional(),
      minutesAgo: z.number().int().positive().default(15),
      limit: z.number().int().positive().max(10_000).default(100),
    }),
    scope: 'read',
    costHint: 'moderate',
    latencyHintMs: 1500,
    async execute(input, ctx) {
      const { logGroup, filterPattern, minutesAgo, limit } = input as {
        logGroup: string
        filterPattern?: string
        minutesAgo: number
        limit: number
      }
      const client = logsClient(ctx.config)
      const endTime = Date.now()
      const startTime = endTime - minutesAgo * 60_000
      const res = await client.send(
        new FilterLogEventsCommand({ logGroupName: logGroup, filterPattern, startTime, endTime, limit }),
        { abortSignal: ctx.signal },
      )
      const data = (res.events ?? []).map((event) => ({
        timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : '',
        message: event.message ?? '',
        logStream: event.logStreamName ?? '',
      }))
      return { summary: `${data.length} log events from ${logGroup}`, data }
    },
  },
]

export function createCloudwatchTelemetrySource(): TelemetrySource<CloudwatchConfig> {
  return {
    manifest: {
      id: 'cloudwatch',
      name: 'AWS CloudWatch',
      version: '0.1.0',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source',
      description: 'Reads CloudWatch alarms, metric statistics, and logs (Insights + filtered events)',
      configSchema: cloudwatchConfigSchema,
      credentialSchema: cloudwatchCredentialSchema,
    },
    async healthCheck(ctx) {
      try {
        const client = cloudwatchClient(ctx.config)
        await client.send(new DescribeAlarmsCommand({ MaxRecords: 1 }), { abortSignal: ctx.signal })
        return { ok: true }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    tools() {
      return tools
    },
  }
}
