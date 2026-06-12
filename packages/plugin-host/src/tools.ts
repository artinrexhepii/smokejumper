import { listPluginInstances, type Db } from '@smokejumper/db'
import type { CostHint, PluginLogger, ToolResult } from '@smokejumper/plugin-sdk'
import type { z } from 'zod'
import { createPluginLogger, createSourceContext } from './context'
import { PluginConfigError } from './errors'
import type { PluginRegistry } from './registry'
import { resolveInstance } from './resolve'

export interface HostTool {
  instanceId: string
  pluginId: string
  name: string
  description: string
  inputSchema: z.ZodTypeAny
  costHint: CostHint
  latencyHintMs: number
  run(input: unknown, opts: { incidentId: string; signal: AbortSignal }): Promise<ToolResult>
}

export interface GetInstanceToolsOptions {
  db: Db
  encryptionKey: string
  registry: PluginRegistry
  projectId: string
  logger?: PluginLogger
  toolTimeoutMs?: number
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true })
  })
}

export async function getInstanceTools(opts: GetInstanceToolsOptions): Promise<HostTool[]> {
  const { db, encryptionKey, registry, projectId } = opts
  const toolTimeoutMs = opts.toolTimeoutMs ?? 30_000
  const logger = opts.logger ?? createPluginLogger('host')
  const tools: HostTool[] = []
  const instances = await listPluginInstances(db, projectId, 'telemetry-source')
  for (const instance of instances) {
    if (!instance.enabled) continue
    const source = registry.telemetrySource(instance.pluginId)
    if (!source) {
      logger.warn(`instance ${instance.id}: no registered telemetry source "${instance.pluginId}", skipping`)
      continue
    }
    let config: unknown
    try {
      ;({ config } = await resolveInstance({ db, encryptionKey, registry, instanceId: instance.id }))
    } catch (err) {
      if (err instanceof PluginConfigError) {
        logger.warn(`instance ${instance.id}: ${err.message}, skipping`)
        continue
      }
      throw err
    }
    for (const spec of source.tools()) {
      // plugins are not trusted to self-police the read-only scope
      const scope: string = spec.scope
      if (scope !== 'read') {
        logger.warn(`tool "${spec.name}" of "${instance.pluginId}" has scope "${scope}", not surfacing it`)
        continue
      }
      tools.push({
        instanceId: instance.id,
        pluginId: instance.pluginId,
        name: `${instance.pluginId}_${spec.name}`,
        description: spec.description,
        inputSchema: spec.inputSchema,
        costHint: spec.costHint,
        latencyHintMs: spec.latencyHintMs,
        async run(input, runOpts) {
          const parsed = spec.inputSchema.parse(input)
          const signal = AbortSignal.any([runOpts.signal, AbortSignal.timeout(toolTimeoutMs)])
          const ctx = {
            ...createSourceContext({
              pluginId: instance.pluginId,
              projectId,
              config,
              signal,
              logger: opts.logger,
            }),
            incidentId: runOpts.incidentId,
          }
          return Promise.race([spec.execute(parsed, ctx), rejectOnAbort(signal)])
        },
      })
    }
  }
  return tools
}
