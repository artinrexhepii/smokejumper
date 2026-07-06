import { z } from 'zod'
import { AppsV1Api, CoreV1Api, KubeConfig, Observable } from '@kubernetes/client-node'
import type { ConfigurationOptions, V1ContainerState } from '@kubernetes/client-node'
import type { TelemetrySource, ToolSpec } from '@smokejumper/plugin-sdk'

export const kubernetesConfigSchema = z.object({
  context: z.string().optional(),
  namespace: z.string().default('default'),
})

export const kubernetesCredentialSchema = z.object({
  kubeconfig: z.string().optional(),
})

export type KubernetesConfig = z.infer<typeof kubernetesConfigSchema> &
  z.infer<typeof kubernetesCredentialSchema>

function loadKubeConfig(config: KubernetesConfig): KubeConfig {
  const kc = new KubeConfig()
  if (config.kubeconfig) {
    kc.loadFromString(atob(config.kubeconfig))
  } else {
    kc.loadFromCluster()
  }
  if (config.context) kc.setCurrentContext(config.context)
  return kc
}

function coreApi(config: KubernetesConfig): CoreV1Api {
  return loadKubeConfig(config).makeApiClient(CoreV1Api)
}

function appsApi(config: KubernetesConfig): AppsV1Api {
  return loadKubeConfig(config).makeApiClient(AppsV1Api)
}

// The generated client has no per-request signal option; the only abort channel
// is a pre-request middleware that sets the signal on the RequestContext.
function abortOptions(signal: AbortSignal): ConfigurationOptions {
  return {
    middleware: [
      {
        pre(context) {
          context.setSignal(signal)
          return new Observable(Promise.resolve(context))
        },
        post(context) {
          return new Observable(Promise.resolve(context))
        },
      },
    ],
    middlewareMergeStrategy: 'append',
  }
}

export function formatAge(since: Date | string | undefined, now: number = Date.now()): string {
  if (!since) return 'unknown'
  const then = typeof since === 'string' ? Date.parse(since) : since.getTime()
  if (Number.isNaN(then)) return 'unknown'
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function describeContainerState(state: V1ContainerState | undefined): string {
  if (!state) return 'unknown'
  if (state.running) return 'running'
  if (state.waiting) return `waiting: ${state.waiting.reason ?? 'unknown'}`
  if (state.terminated) {
    return `terminated: ${state.terminated.reason ?? 'unknown'} (exit ${state.terminated.exitCode ?? '?'})`
  }
  return 'unknown'
}

const tools: ToolSpec<KubernetesConfig>[] = [
  {
    name: 'list_pods',
    description: 'List pods in a namespace with phase, readiness, restart counts, node, and age',
    inputSchema: z.object({ namespace: z.string().optional(), labelSelector: z.string().optional() }),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 400,
    async execute(input, ctx) {
      const { namespace, labelSelector } = input as { namespace?: string; labelSelector?: string }
      const ns = namespace ?? ctx.config.namespace
      const list = await coreApi(ctx.config).listNamespacedPod({ namespace: ns, labelSelector }, abortOptions(ctx.signal))
      const data = (list.items ?? []).map((pod) => {
        const statuses = pod.status?.containerStatuses ?? []
        const ready = statuses.filter((c) => c.ready).length
        const restarts = statuses.reduce((sum, c) => sum + (c.restartCount ?? 0), 0)
        return {
          name: pod.metadata?.name ?? '',
          phase: pod.status?.phase ?? 'Unknown',
          ready: `${ready}/${statuses.length}`,
          restarts,
          node: pod.spec?.nodeName ?? '',
          age: formatAge(pod.metadata?.creationTimestamp),
        }
      })
      return { summary: `${data.length} pods in ${ns}`, data }
    },
  },
  {
    name: 'pod_logs',
    description: 'Fetch recent logs from a pod container',
    inputSchema: z.object({
      pod: z.string().min(1),
      namespace: z.string().optional(),
      container: z.string().optional(),
      tailLines: z.number().int().positive().max(5000).default(200),
      previous: z.boolean().default(false),
    }),
    scope: 'read',
    costHint: 'moderate',
    latencyHintMs: 800,
    async execute(input, ctx) {
      const { pod, namespace, container, tailLines, previous } = input as {
        pod: string
        namespace?: string
        container?: string
        tailLines: number
        previous: boolean
      }
      const ns = namespace ?? ctx.config.namespace
      const logs = await coreApi(ctx.config).readNamespacedPodLog(
        { name: pod, namespace: ns, container, tailLines, previous },
        abortOptions(ctx.signal),
      )
      return { summary: `logs for ${pod} (${ns})`, data: logs }
    },
  },
  {
    name: 'describe_pod',
    description: 'Describe a pod: phase, conditions, container restart/last-state reasons, and recent events',
    inputSchema: z.object({ pod: z.string().min(1), namespace: z.string().optional() }),
    scope: 'read',
    costHint: 'moderate',
    latencyHintMs: 700,
    async execute(input, ctx) {
      const { pod, namespace } = input as { pod: string; namespace?: string }
      const ns = namespace ?? ctx.config.namespace
      const api = coreApi(ctx.config)
      const podInfo = await api.readNamespacedPod({ name: pod, namespace: ns }, abortOptions(ctx.signal))
      const eventList = await api.listNamespacedEvent(
        { namespace: ns, fieldSelector: `involvedObject.name=${pod}` },
        abortOptions(ctx.signal),
      )
      const containers = (podInfo.status?.containerStatuses ?? []).map((c) => ({
        name: c.name,
        ready: c.ready ?? false,
        restartCount: c.restartCount ?? 0,
        state: describeContainerState(c.state),
        lastStateReason: c.lastState?.terminated?.reason ?? c.lastState?.waiting?.reason ?? null,
      }))
      const conditions = (podInfo.status?.conditions ?? []).map((c) => ({
        type: c.type,
        status: c.status,
        reason: c.reason ?? null,
      }))
      const events = (eventList.items ?? []).map((e) => ({
        type: e.type ?? '',
        reason: e.reason ?? '',
        message: e.message ?? '',
        count: e.count ?? 1,
      }))
      return {
        summary: `${pod}: ${podInfo.status?.phase ?? 'Unknown'}, ${containers.length} containers, ${events.length} events`,
        data: { phase: podInfo.status?.phase ?? 'Unknown', conditions, containers, events },
      }
    },
  },
  {
    name: 'list_events',
    description: 'List recent events in a namespace within a time window',
    inputSchema: z.object({
      namespace: z.string().optional(),
      sinceMinutes: z.number().int().positive().default(30),
    }),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 400,
    async execute(input, ctx) {
      const { namespace, sinceMinutes } = input as { namespace?: string; sinceMinutes: number }
      const ns = namespace ?? ctx.config.namespace
      const cutoff = Date.now() - sinceMinutes * 60_000
      const list = await coreApi(ctx.config).listNamespacedEvent({ namespace: ns }, abortOptions(ctx.signal))
      const data = (list.items ?? [])
        .filter((e) => {
          const stamp = e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp
          if (!stamp) return true
          const time = stamp instanceof Date ? stamp.getTime() : Date.parse(String(stamp))
          return Number.isNaN(time) || time >= cutoff
        })
        .map((e) => ({
          type: e.type ?? '',
          reason: e.reason ?? '',
          message: e.message ?? '',
          involvedObject: `${e.involvedObject?.kind ?? ''}/${e.involvedObject?.name ?? ''}`,
          count: e.count ?? 1,
        }))
      return { summary: `${data.length} events in ${ns}`, data }
    },
  },
  {
    name: 'list_deployments',
    description: 'List deployments with desired/ready/available replicas, image, and availability',
    inputSchema: z.object({ namespace: z.string().optional() }),
    scope: 'read',
    costHint: 'cheap',
    latencyHintMs: 400,
    async execute(input, ctx) {
      const { namespace } = input as { namespace?: string }
      const ns = namespace ?? ctx.config.namespace
      const list = await appsApi(ctx.config).listNamespacedDeployment({ namespace: ns }, abortOptions(ctx.signal))
      const data = (list.items ?? []).map((d) => ({
        name: d.metadata?.name ?? '',
        desired: d.spec?.replicas ?? 0,
        ready: d.status?.readyReplicas ?? 0,
        available: d.status?.availableReplicas ?? 0,
        image: d.spec?.template?.spec?.containers?.[0]?.image ?? '',
        availability: (d.status?.conditions ?? []).find((c) => c.type === 'Available')?.status ?? 'Unknown',
      }))
      return { summary: `${data.length} deployments in ${ns}`, data }
    },
  },
]

export function createKubernetesTelemetrySource(): TelemetrySource<KubernetesConfig> {
  return {
    manifest: {
      id: 'kubernetes',
      name: 'Kubernetes',
      version: '0.1.0',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source',
      description: 'Reads pods, logs, events, and deployments via the Kubernetes CoreV1/AppsV1 APIs',
      configSchema: kubernetesConfigSchema,
      credentialSchema: kubernetesCredentialSchema,
    },
    async healthCheck(ctx) {
      try {
        await coreApi(ctx.config).listNamespacedPod(
          { namespace: ctx.config.namespace, limit: 1 },
          abortOptions(ctx.signal),
        )
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
