import { z } from 'zod'
import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch'
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
