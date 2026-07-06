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
  instances: [] as Array<{
    loadFromString: ReturnType<typeof vi.fn>
    loadFromCluster: ReturnType<typeof vi.fn>
    setCurrentContext: ReturnType<typeof vi.fn>
  }>,
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

import { createKubernetesTelemetrySource, formatAge, type KubernetesConfig } from '../src/index'

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

beforeEach(() => {
  instances.length = 0
  vi.clearAllMocks()
})

describe('formatAge', () => {
  const now = Date.parse('2026-07-05T12:00:00Z')
  it('formats seconds, minutes, hours, and days', () => {
    expect(formatAge(new Date('2026-07-05T11:59:30Z'), now)).toBe('30s')
    expect(formatAge(new Date('2026-07-05T11:30:00Z'), now)).toBe('30m')
    expect(formatAge(new Date('2026-07-05T09:00:00Z'), now)).toBe('3h')
    expect(formatAge(new Date('2026-07-02T12:00:00Z'), now)).toBe('3d')
    expect(formatAge(undefined, now)).toBe('unknown')
  })
})

describe('kubernetes healthCheck', () => {
  it('lists one pod in the configured namespace and reports ok', async () => {
    coreMock.listNamespacedPod.mockResolvedValue({ items: [{ metadata: { name: 'x' } }] })
    const controller = new AbortController()
    const health = await source.healthCheck({
      ...createTestContext<KubernetesConfig>({ namespace: 'default', kubeconfig: btoa('kc') }),
      signal: controller.signal,
    })
    expect(health).toEqual({ ok: true })
    const [params, options] = coreMock.listNamespacedPod.mock.calls[0]!
    expect(params).toMatchObject({ namespace: 'default', limit: 1 })
    expectAbortMiddleware(options, controller.signal)
  })

  it('reports the error when the API call fails', async () => {
    coreMock.listNamespacedPod.mockRejectedValue(new Error('forbidden'))
    const health = await source.healthCheck(
      createTestContext<KubernetesConfig>({ namespace: 'default', kubeconfig: btoa('kc') }),
    )
    expect(health).toEqual({ ok: false, message: 'forbidden' })
  })
})

describe('kubernetes list_pods', () => {
  it('maps pod summaries, passes the signal, and loads the base64 kubeconfig', async () => {
    coreMock.listNamespacedPod.mockResolvedValue({
      items: [
        {
          metadata: { name: 'shop-api-abc', creationTimestamp: new Date('2020-01-01T00:00:00Z') },
          spec: { nodeName: 'node-1' },
          status: {
            phase: 'Running',
            containerStatuses: [
              { ready: true, restartCount: 0 },
              { ready: false, restartCount: 4 },
            ],
          },
        },
      ],
    })
    const controller = new AbortController()
    const tool = source.tools().find((t) => t.name === 'list_pods')!
    const result = await tool.execute(
      tool.inputSchema.parse({ labelSelector: 'app=shop-api' }),
      toolCtx({ namespace: 'default', kubeconfig: btoa('kube-config-yaml') }, controller.signal),
    )
    const pods = result.data as Array<{
      name: string
      phase: string
      ready: string
      restarts: number
      node: string
      age: string
    }>
    expect(pods).toHaveLength(1)
    expect(pods[0]).toMatchObject({ name: 'shop-api-abc', phase: 'Running', ready: '1/2', restarts: 4, node: 'node-1' })
    expect(pods[0]!.age).toMatch(/^\d+d$/)
    const [params, options] = coreMock.listNamespacedPod.mock.calls[0]!
    expect(params).toMatchObject({ namespace: 'default', labelSelector: 'app=shop-api' })
    expectAbortMiddleware(options, controller.signal)
    expect(instances[0]!.loadFromString).toHaveBeenCalledWith('kube-config-yaml')
  })

  it('loads in-cluster config and honors the configured context when no kubeconfig is set', async () => {
    coreMock.listNamespacedPod.mockResolvedValue({ items: [] })
    const tool = source.tools().find((t) => t.name === 'list_pods')!
    await tool.execute(
      tool.inputSchema.parse({}),
      toolCtx({ namespace: 'default', context: 'prod' }, new AbortController().signal),
    )
    expect(instances[0]!.loadFromCluster).toHaveBeenCalled()
    expect(instances[0]!.loadFromString).not.toHaveBeenCalled()
    expect(instances[0]!.setCurrentContext).toHaveBeenCalledWith('prod')
  })
})
