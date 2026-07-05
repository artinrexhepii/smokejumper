import { getPluginInstance, type Db } from '@smokejumper/db'
import type { SourceHealth } from '@smokejumper/plugin-sdk'
import { createSourceContext } from './context'
import { InstanceNotFoundError, PluginConfigError } from './errors'
import type { PluginRegistry } from './registry'
import { resolveInstance } from './resolve'

export interface RunInstanceHealthCheckOptions {
  db: Db
  encryptionKey: string
  registry: PluginRegistry
  instanceId: string
  timeoutMs?: number
}

export async function runInstanceHealthCheck(opts: RunInstanceHealthCheckOptions): Promise<SourceHealth> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const instance = await getPluginInstance(opts.db, opts.instanceId)
  if (!instance) throw new InstanceNotFoundError(opts.instanceId)
  const source = opts.registry.telemetrySource(instance.pluginId)
  if (!source) return { ok: true }
  let config: unknown
  try {
    ;({ config } = await resolveInstance({
      db: opts.db,
      encryptionKey: opts.encryptionKey,
      registry: opts.registry,
      instanceId: opts.instanceId,
    }))
  } catch (err) {
    if (err instanceof PluginConfigError) return { ok: false, message: err.message }
    throw err
  }
  const signal = AbortSignal.timeout(timeoutMs)
  const ctx = createSourceContext({
    pluginId: instance.pluginId,
    projectId: instance.projectId,
    config,
    signal,
  })
  try {
    return await source.healthCheck(ctx)
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
