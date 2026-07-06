import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'

const { coreMock, appsMock, instances } = vi.hoisted(() => ({
  coreMock: {
    listNamespacedPod: vi.fn(),
    readNamespacedPodLog: vi.fn(),
    readNamespacedPod: vi.fn(),
    listNamespacedEvent: vi.fn(),
  },
  appsMock: { listNamespacedDeployment: vi.fn() },
  instances: [] as unknown[],
}))

vi.mock('@kubernetes/client-node', () => {
  class CoreV1Api {}
  class AppsV1Api {}
  class KubeConfig {
    loadFromString = vi.fn()
    loadFromCluster = vi.fn()
    setCurrentContext = vi.fn()
    makeApiClient = vi.fn((api: unknown) => (api === CoreV1Api ? coreMock : appsMock))
    constructor() {
      instances.push(this)
    }
  }
  class Observable {
    promise: Promise<unknown>
    constructor(promise: Promise<unknown>) {
      this.promise = promise
    }
  }
  return { KubeConfig, CoreV1Api, AppsV1Api, Observable }
})

import { createKubernetesTelemetrySource, type KubernetesConfig } from '../src/index'

const source = createKubernetesTelemetrySource()

function toolCtx(config: KubernetesConfig, signal: AbortSignal) {
  return { ...createTestContext<KubernetesConfig>(config), signal, incidentId: 'inc-1' }
}

function expectAbortMiddleware(options: unknown, signal: AbortSignal) {
  const opts = options as {
    middleware: Array<{ pre: (ctx: { setSignal: (s: AbortSignal) => void }) => unknown }>
    middlewareMergeStrategy: string
  }
  expect(opts.middlewareMergeStrategy).toBe('append')
  expect(opts.middleware).toHaveLength(1)
  const setSignal = vi.fn()
  opts.middleware[0]!.pre({ setSignal })
  expect(setSignal).toHaveBeenCalledWith(signal)
}

const tool = (name: string) => source.tools().find((t) => t.name === name)!

beforeEach(() => {
  instances.length = 0
  vi.clearAllMocks()
})

describe('kubernetes pod_logs', () => {
  it('returns the raw log text and passes params and the signal', async () => {
    coreMock.readNamespacedPodLog.mockResolvedValue('line1\nline2\n')
    const controller = new AbortController()
    const result = await tool('pod_logs').execute(
      tool('pod_logs').inputSchema.parse({ pod: 'worker-1', container: 'app', tailLines: 50, previous: true }),
      toolCtx({ namespace: 'prod', kubeconfig: btoa('kc') }, controller.signal),
    )
    expect(result.data).toBe('line1\nline2\n')
    const [params, options] = coreMock.readNamespacedPodLog.mock.calls[0]!
    expect(params).toMatchObject({ name: 'worker-1', namespace: 'prod', container: 'app', tailLines: 50, previous: true })
    expectAbortMiddleware(options, controller.signal)
  })
})

describe('kubernetes describe_pod', () => {
  it('surfaces container restart/last-state reason and recent events', async () => {
    coreMock.readNamespacedPod.mockResolvedValue({
      status: {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False', reason: 'ContainersNotReady' }],
        containerStatuses: [
          {
            name: 'app',
            ready: false,
            restartCount: 5,
            state: { waiting: { reason: 'CrashLoopBackOff' } },
            lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } },
          },
        ],
      },
    })
    coreMock.listNamespacedEvent.mockResolvedValue({
      items: [{ type: 'Warning', reason: 'BackOff', message: 'Back-off restarting failed container', count: 12 }],
    })
    const controller = new AbortController()
    const result = await tool('describe_pod').execute(
      tool('describe_pod').inputSchema.parse({ pod: 'worker-1' }),
      toolCtx({ namespace: 'default', kubeconfig: btoa('kc') }, controller.signal),
    )
    expect(result.data).toEqual({
      phase: 'Running',
      conditions: [{ type: 'Ready', status: 'False', reason: 'ContainersNotReady' }],
      containers: [
        { name: 'app', ready: false, restartCount: 5, state: 'waiting: CrashLoopBackOff', lastStateReason: 'OOMKilled' },
      ],
      events: [{ type: 'Warning', reason: 'BackOff', message: 'Back-off restarting failed container', count: 12 }],
    })
    const [podParams, podOptions] = coreMock.readNamespacedPod.mock.calls[0]!
    expect(podParams).toMatchObject({ name: 'worker-1', namespace: 'default' })
    expectAbortMiddleware(podOptions, controller.signal)
    const [eventParams] = coreMock.listNamespacedEvent.mock.calls[0]!
    expect(eventParams).toMatchObject({ namespace: 'default', fieldSelector: 'involvedObject.name=worker-1' })
  })
})

describe('kubernetes list_events', () => {
  it('returns only events within the window with a flattened involvedObject', async () => {
    coreMock.listNamespacedEvent.mockResolvedValue({
      items: [
        {
          type: 'Warning',
          reason: 'Unhealthy',
          message: 'readiness probe failed',
          involvedObject: { kind: 'Pod', name: 'shop-api-1' },
          count: 3,
          lastTimestamp: new Date(),
        },
        {
          type: 'Normal',
          reason: 'Pulled',
          message: 'old event',
          involvedObject: { kind: 'Pod', name: 'shop-api-1' },
          count: 1,
          lastTimestamp: new Date('2000-01-01T00:00:00Z'),
        },
      ],
    })
    const controller = new AbortController()
    const result = await tool('list_events').execute(
      tool('list_events').inputSchema.parse({ sinceMinutes: 30 }),
      toolCtx({ namespace: 'default', kubeconfig: btoa('kc') }, controller.signal),
    )
    expect(result.data).toEqual([
      { type: 'Warning', reason: 'Unhealthy', message: 'readiness probe failed', involvedObject: 'Pod/shop-api-1', count: 3 },
    ])
    const [, options] = coreMock.listNamespacedEvent.mock.calls[0]!
    expectAbortMiddleware(options, controller.signal)
  })
})

describe('kubernetes list_deployments', () => {
  it('maps replica counts, image, and availability condition', async () => {
    appsMock.listNamespacedDeployment.mockResolvedValue({
      items: [
        {
          metadata: { name: 'shop-api' },
          spec: { replicas: 3, template: { spec: { containers: [{ image: 'shop-api:1.4.2' }] } } },
          status: { readyReplicas: 2, availableReplicas: 2, conditions: [{ type: 'Available', status: 'False' }] },
        },
      ],
    })
    const controller = new AbortController()
    const result = await tool('list_deployments').execute(
      tool('list_deployments').inputSchema.parse({}),
      toolCtx({ namespace: 'default', kubeconfig: btoa('kc') }, controller.signal),
    )
    expect(result.data).toEqual([
      { name: 'shop-api', desired: 3, ready: 2, available: 2, image: 'shop-api:1.4.2', availability: 'False' },
    ])
    const [params, options] = appsMock.listNamespacedDeployment.mock.calls[0]!
    expect(params).toMatchObject({ namespace: 'default' })
    expectAbortMiddleware(options, controller.signal)
  })
})
