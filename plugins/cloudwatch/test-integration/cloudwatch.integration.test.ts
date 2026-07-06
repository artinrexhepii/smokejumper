import { beforeAll, describe, expect, it } from 'vitest'
import { CloudWatchClient, PutMetricAlarmCommand } from '@aws-sdk/client-cloudwatch'
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createCloudwatchTelemetrySource, type CloudwatchConfig } from '../src/index'

const run = describe.skipIf(!process.env.SMOKEJUMPER_INTEGRATION)

run('cloudwatch adapter against localstack', () => {
  const region = 'us-east-1'
  const config: CloudwatchConfig = { region }
  const source = createCloudwatchTelemetrySource()
  const logGroup = '/smokejumper/integration'

  beforeAll(async () => {
    const endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566'
    process.env.AWS_ENDPOINT_URL = endpoint
    process.env.AWS_ACCESS_KEY_ID = 'test'
    process.env.AWS_SECRET_ACCESS_KEY = 'test'
    process.env.AWS_REGION = region
    const credentials = { accessKeyId: 'test', secretAccessKey: 'test' }

    const cw = new CloudWatchClient({ region, endpoint, credentials })
    await cw.send(
      new PutMetricAlarmCommand({
        AlarmName: 'sj-integration-alarm',
        Namespace: 'Smokejumper',
        MetricName: 'ErrorRate',
        ComparisonOperator: 'GreaterThanThreshold',
        Threshold: 1,
        EvaluationPeriods: 1,
        Period: 60,
        Statistic: 'Average',
      }),
    )

    const logs = new CloudWatchLogsClient({ region, endpoint, credentials })
    await logs.send(new CreateLogGroupCommand({ logGroupName: logGroup }))
    await logs.send(new CreateLogStreamCommand({ logGroupName: logGroup, logStreamName: 'stream-1' }))
    await logs.send(
      new PutLogEventsCommand({
        logGroupName: logGroup,
        logStreamName: 'stream-1',
        logEvents: [{ timestamp: Date.now(), message: 'integration log line' }],
      }),
    )
  })

  it('reports healthy', async () => {
    const health = await source.healthCheck(createTestContext<CloudwatchConfig>(config))
    expect(health.ok).toBe(true)
  })

  it('describes the seeded alarm', async () => {
    const tool = source.tools().find((t) => t.name === 'describe_alarms')!
    const ctx = { ...createTestContext<CloudwatchConfig>(config), incidentId: 'inc-int' }
    const result = await tool.execute(tool.inputSchema.parse({}), ctx)
    const names = (result.data as Array<{ name: string }>).map((a) => a.name)
    expect(names).toContain('sj-integration-alarm')
  })

  it('reads the seeded log events', async () => {
    const tool = source.tools().find((t) => t.name === 'get_log_events')!
    const ctx = { ...createTestContext<CloudwatchConfig>(config), incidentId: 'inc-int' }
    const result = await tool.execute(tool.inputSchema.parse({ logGroup, minutesAgo: 60 }), ctx)
    const messages = (result.data as Array<{ message: string }>).map((e) => e.message)
    expect(messages).toContain('integration log line')
  })
})
