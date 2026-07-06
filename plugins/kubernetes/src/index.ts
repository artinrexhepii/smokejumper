import { z } from 'zod'
import { AppsV1Api, CoreV1Api, KubeConfig, Observable } from '@kubernetes/client-node'
import type { ConfigurationOptions } from '@kubernetes/client-node'
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
