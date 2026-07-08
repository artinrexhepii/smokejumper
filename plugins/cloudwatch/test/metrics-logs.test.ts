import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'

const { cwSend, logsSend, fromChain } = vi.hoisted(() => ({
  cwSend: vi.fn(),
  logsSend: vi.fn(),
  fromChain: vi.fn(() => async () => ({ accessKeyId: 'chain', secretAccessKey: 'chain' })),
}))

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: vi.fn(() => ({ send: cwSend })),
  DescribeAlarmsCommand: vi.fn((input) => ({ _name: 'DescribeAlarms', input })),
  GetMetricStatisticsCommand: vi.fn((input) => ({ _name: 'GetMetricStatistics', input })),
  ListMetricsCommand: vi.fn((input) => ({ _name: 'ListMetrics', input })),
}))

vi.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: vi.fn(() => ({ send: logsSend })),
  StartQueryCommand: vi.fn((input) => ({ _name: 'StartQuery', input })),
  GetQueryResultsCommand: vi.fn((input) => ({ _name: 'GetQueryResults', input })),
  FilterLogEventsCommand: vi.fn((input) => ({ _name: 'FilterLogEvents', input })),
  DescribeLogGroupsCommand: vi.fn((input) => ({ _name: 'DescribeLogGroups', input })),
}))

vi.mock('@aws-sdk/credential-providers', () => ({ fromNodeProviderChain: fromChain }))

import { createCloudwatchTelemetrySource, type CloudwatchConfig } from '../src/index'

const source = createCloudwatchTelemetrySource()

function toolCtx(signal: AbortSignal) {
  return { ...createTestContext<CloudwatchConfig>({ region: 'us-east-1' }), signal, incidentId: 'inc-1' }
}

const tool = (name: string) => source.tools().find((t) => t.name === name)!

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cloudwatch get_metric_statistics', () => {
  it('maps datapoints and requests a standard statistic in ascending time order', async () => {
    cwSend.mockResolvedValue({
      Datapoints: [
        { Timestamp: new Date('2026-07-05T10:05:00Z'), Average: 12, Unit: 'Count' },
        { Timestamp: new Date('2026-07-05T10:00:00Z'), Average: 8, Unit: 'Count' },
      ],
    })
    const controller = new AbortController()
    const result = await tool('get_metric_statistics').execute(
      tool('get_metric_statistics').inputSchema.parse({
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensions: { DBInstanceIdentifier: 'shop' },
        stat: 'Average',
        periodSeconds: 300,
        minutesAgo: 60,
      }),
      toolCtx(controller.signal),
    )
    expect(result.data).toEqual([
      { timestamp: '2026-07-05T10:00:00.000Z', value: 8, unit: 'Count' },
      { timestamp: '2026-07-05T10:05:00.000Z', value: 12, unit: 'Count' },
    ])
    const [command, options] = cwSend.mock.calls[0]!
    expect(command.input).toMatchObject({
      Namespace: 'AWS/RDS',
      MetricName: 'CPUUtilization',
      Dimensions: [{ Name: 'DBInstanceIdentifier', Value: 'shop' }],
      Period: 300,
      Statistics: ['Average'],
    })
    expect(command.input.ExtendedStatistics).toBeUndefined()
    expect(command.input.StartTime).toBeInstanceOf(Date)
    expect(command.input.EndTime).toBeInstanceOf(Date)
    expect(options).toEqual({ abortSignal: controller.signal })
  })

  it('uses ExtendedStatistics for p99', async () => {
    cwSend.mockResolvedValue({
      Datapoints: [
        { Timestamp: new Date('2026-07-05T10:00:00Z'), ExtendedStatistics: { p99: 42 }, Unit: 'Milliseconds' },
      ],
    })
    const result = await tool('get_metric_statistics').execute(
      tool('get_metric_statistics').inputSchema.parse({
        namespace: 'AWS/ApplicationELB',
        metricName: 'TargetResponseTime',
        stat: 'p99',
      }),
      toolCtx(new AbortController().signal),
    )
    expect(result.data).toEqual([{ timestamp: '2026-07-05T10:00:00.000Z', value: 42, unit: 'Milliseconds' }])
    const [command] = cwSend.mock.calls[0]!
    expect(command.input.ExtendedStatistics).toEqual(['p99'])
    expect(command.input.Statistics).toBeUndefined()
  })
})

describe('cloudwatch list_metrics', () => {
  it('lists metrics with their real dimensions and passes the namespace + signal', async () => {
    cwSend.mockResolvedValue({
      Metrics: [
        {
          Namespace: 'AWS/ApplicationELB',
          MetricName: 'HTTPCode_Target_5XX_Count',
          Dimensions: [{ Name: 'LoadBalancer', Value: 'app/prod-alb/0a1b2c3d4e5f6a7b' }],
        },
        {
          Namespace: 'AWS/ApplicationELB',
          MetricName: 'RequestCount',
          Dimensions: [{ Name: 'LoadBalancer', Value: 'app/prod-alb/0a1b2c3d4e5f6a7b' }],
        },
      ],
    })
    const controller = new AbortController()
    const result = await tool('list_metrics').execute(
      tool('list_metrics').inputSchema.parse({ namespace: 'AWS/ApplicationELB', limit: 100 }),
      toolCtx(controller.signal),
    )
    expect(result.data).toEqual([
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_5XX_Count',
        dimensions: { LoadBalancer: 'app/prod-alb/0a1b2c3d4e5f6a7b' },
      },
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'RequestCount',
        dimensions: { LoadBalancer: 'app/prod-alb/0a1b2c3d4e5f6a7b' },
      },
    ])
    expect(result.summary).toBe('2 metrics')
    const [command, options] = cwSend.mock.calls[0]!
    expect(command._name).toBe('ListMetrics')
    expect(command.input).toMatchObject({ Namespace: 'AWS/ApplicationELB' })
    expect(command.input.MetricName).toBeUndefined()
    expect(options).toEqual({ abortSignal: controller.signal })
  })

  it('caps the returned metrics at the requested limit', async () => {
    cwSend.mockResolvedValue({
      Metrics: Array.from({ length: 8 }, (_, i) => ({
        Namespace: 'AWS/RDS',
        MetricName: 'CPUUtilization',
        Dimensions: [{ Name: 'DBInstanceIdentifier', Value: `db-${i}` }],
      })),
    })
    const result = await tool('list_metrics').execute(
      tool('list_metrics').inputSchema.parse({ namespace: 'AWS/RDS', limit: 3 }),
      toolCtx(new AbortController().signal),
    )
    expect(result.data).toHaveLength(3)
  })
})

describe('cloudwatch query_logs_insights', () => {
  it('starts a query, polls until complete, and flattens rows', async () => {
    let polls = 0
    logsSend.mockImplementation(async (command: { _name: string }) => {
      if (command._name === 'StartQuery') return { queryId: 'q-1' }
      if (command._name === 'GetQueryResults') {
        polls += 1
        if (polls < 2) return { status: 'Running', results: [] }
        return {
          status: 'Complete',
          results: [
            [
              { field: '@timestamp', value: '2026-07-05 10:00:00' },
              { field: '@message', value: 'boom' },
            ],
          ],
        }
      }
      throw new Error(`unexpected command ${command._name}`)
    })
    const controller = new AbortController()
    const result = await tool('query_logs_insights').execute(
      tool('query_logs_insights').inputSchema.parse({
        logGroup: '/aws/app',
        query: 'fields @message',
        minutesAgo: 30,
        limit: 100,
      }),
      toolCtx(controller.signal),
    )
    expect(result.data).toEqual([{ '@timestamp': '2026-07-05 10:00:00', '@message': 'boom' }])
    const startCommand = logsSend.mock.calls[0]![0]
    expect(startCommand._name).toBe('StartQuery')
    expect(startCommand.input).toMatchObject({ logGroupName: '/aws/app', queryString: 'fields @message', limit: 100 })
    for (const [, options] of logsSend.mock.calls) {
      expect(options).toEqual({ abortSignal: controller.signal })
    }
  })

  it('throws when the query ends in a non-complete status', async () => {
    logsSend.mockImplementation(async (command: { _name: string }) => {
      if (command._name === 'StartQuery') return { queryId: 'q-2' }
      return { status: 'Failed' }
    })
    await expect(
      tool('query_logs_insights').execute(
        tool('query_logs_insights').inputSchema.parse({ logGroup: '/aws/app', query: 'fields @message' }),
        toolCtx(new AbortController().signal),
      ),
    ).rejects.toThrow(/Failed/)
  })
})

describe('cloudwatch list_log_groups', () => {
  it('lists log groups sorted by stored size, largest first, and passes the prefix + signal', async () => {
    logsSend.mockResolvedValue({
      logGroups: [
        { logGroupName: '/ecs/admin-web', storedBytes: 1_024 },
        { logGroupName: '/ecs/api', storedBytes: 999_999 },
        { logGroupName: '/aws/ses/set', storedBytes: 0 },
      ],
    })
    const controller = new AbortController()
    const result = await tool('list_log_groups').execute(
      tool('list_log_groups').inputSchema.parse({ nameContains: 'shoferiim', limit: 50 }),
      toolCtx(controller.signal),
    )
    expect(result.data).toEqual([
      { name: '/ecs/api', storedBytes: 999_999 },
      { name: '/ecs/admin-web', storedBytes: 1_024 },
      { name: '/aws/ses/set', storedBytes: 0 },
    ])
    expect(result.summary).toBe('3 log groups')
    const [command, options] = logsSend.mock.calls[0]!
    expect(command._name).toBe('DescribeLogGroups')
    // substring match (logGroupNamePattern), not a prefix — finds '/ecs/shoferiim-api'
    expect(command.input).toMatchObject({ logGroupNamePattern: 'shoferiim', limit: 50 })
    expect(command.input.logGroupNamePrefix).toBeUndefined()
    expect(options).toEqual({ abortSignal: controller.signal })
  })

  it('omits the filter when none is given and defaults the limit', async () => {
    logsSend.mockResolvedValue({ logGroups: [] })
    await tool('list_log_groups').execute(
      tool('list_log_groups').inputSchema.parse({}),
      toolCtx(new AbortController().signal),
    )
    const [command] = logsSend.mock.calls[0]!
    expect(command.input.logGroupNamePattern).toBeUndefined()
    expect(command.input.limit).toBe(50)
  })
})

describe('cloudwatch get_log_events', () => {
  it('maps filtered events and passes the signal', async () => {
    logsSend.mockResolvedValue({
      events: [{ timestamp: 1751709600000, message: 'error: db timeout', logStreamName: 'app/abc' }],
    })
    const controller = new AbortController()
    const result = await tool('get_log_events').execute(
      tool('get_log_events').inputSchema.parse({ logGroup: '/aws/app', filterPattern: 'error', minutesAgo: 15, limit: 100 }),
      toolCtx(controller.signal),
    )
    expect(result.data).toEqual([
      { timestamp: new Date(1751709600000).toISOString(), message: 'error: db timeout', logStream: 'app/abc' },
    ])
    const [command, options] = logsSend.mock.calls[0]!
    expect(command._name).toBe('FilterLogEvents')
    expect(command.input).toMatchObject({ logGroupName: '/aws/app', filterPattern: 'error', limit: 100 })
    expect(options).toEqual({ abortSignal: controller.signal })
  })
})
