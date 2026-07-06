import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'

const { cwSend, fromChain } = vi.hoisted(() => ({
  cwSend: vi.fn(),
  fromChain: vi.fn(() => async () => ({ accessKeyId: 'chain', secretAccessKey: 'chain' })),
}))

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: vi.fn(() => ({ send: cwSend })),
  DescribeAlarmsCommand: vi.fn((input) => ({ _name: 'DescribeAlarms', input })),
}))

vi.mock('@aws-sdk/credential-providers', () => ({ fromNodeProviderChain: fromChain }))

import { CloudWatchClient } from '@aws-sdk/client-cloudwatch'
import { createCloudwatchTelemetrySource, type CloudwatchConfig } from '../src/index'

const source = createCloudwatchTelemetrySource()

function toolCtx(config: CloudwatchConfig, signal: AbortSignal) {
  return { ...createTestContext<CloudwatchConfig>(config), signal, incidentId: 'inc-1' }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cloudwatch healthCheck', () => {
  it('sends DescribeAlarms with MaxRecords 1 and reports ok', async () => {
    cwSend.mockResolvedValue({ MetricAlarms: [] })
    const controller = new AbortController()
    const health = await source.healthCheck({
      ...createTestContext<CloudwatchConfig>({ region: 'us-east-1' }),
      signal: controller.signal,
    })
    expect(health).toEqual({ ok: true })
    const [command, options] = cwSend.mock.calls[0]!
    expect(command).toMatchObject({ _name: 'DescribeAlarms', input: { MaxRecords: 1 } })
    expect(options).toEqual({ abortSignal: controller.signal })
  })

  it('reports the error message when the SDK throws', async () => {
    cwSend.mockRejectedValue(new Error('AccessDenied'))
    const health = await source.healthCheck(createTestContext<CloudwatchConfig>({ region: 'us-east-1' }))
    expect(health).toEqual({ ok: false, message: 'AccessDenied' })
  })
})

describe('cloudwatch describe_alarms', () => {
  it('maps alarms, passes filters and the abort signal, and uses the default credential chain', async () => {
    cwSend.mockResolvedValue({
      MetricAlarms: [
        {
          AlarmName: 'HighErrors',
          StateValue: 'ALARM',
          MetricName: 'ErrorRate',
          Namespace: 'Shop',
          Threshold: 5,
          ComparisonOperator: 'GreaterThanThreshold',
          StateReason: 'threshold breached',
        },
      ],
    })
    const controller = new AbortController()
    const tool = source.tools().find((t) => t.name === 'describe_alarms')!
    const result = await tool.execute(
      tool.inputSchema.parse({ stateValue: 'ALARM', alarmNamePrefix: 'High' }),
      toolCtx({ region: 'us-east-1' }, controller.signal),
    )
    expect(result.summary).toBe('1 alarms')
    expect(result.data).toEqual([
      {
        name: 'HighErrors',
        state: 'ALARM',
        metric: 'ErrorRate',
        namespace: 'Shop',
        threshold: 5,
        comparison: 'GreaterThanThreshold',
        reason: 'threshold breached',
      },
    ])
    const [command, options] = cwSend.mock.calls[0]!
    expect(command.input).toEqual({ StateValue: 'ALARM', AlarmNamePrefix: 'High', MaxRecords: 100 })
    expect(options).toEqual({ abortSignal: controller.signal })
    expect(fromChain).toHaveBeenCalled()
  })

  it('constructs the client with configured static credentials when provided', async () => {
    cwSend.mockResolvedValue({ MetricAlarms: [] })
    const tool = source.tools().find((t) => t.name === 'describe_alarms')!
    await tool.execute(
      tool.inputSchema.parse({}),
      toolCtx(
        { region: 'eu-west-1', accessKeyId: 'AKIA', secretAccessKey: 'shh', sessionToken: 'tok' },
        new AbortController().signal,
      ),
    )
    expect(CloudWatchClient).toHaveBeenCalledWith({
      region: 'eu-west-1',
      credentials: { accessKeyId: 'AKIA', secretAccessKey: 'shh', sessionToken: 'tok' },
    })
    expect(fromChain).not.toHaveBeenCalled()
  })
})
