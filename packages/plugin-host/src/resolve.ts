import { decryptJson, getPluginInstance, type Db, type PluginInstance } from '@smokejumper/db'
import { InstanceNotFoundError, PluginConfigError, UnknownPluginError } from './errors'
import type { PluginRegistry } from './registry'
import { validateInstanceInput } from './validate'

export interface ResolveInstanceOptions {
  db: Db
  encryptionKey: string
  registry: PluginRegistry
  instanceId: string
}

export interface ResolvedInstance {
  instance: PluginInstance
  config: unknown
}

export async function resolveInstance(opts: ResolveInstanceOptions): Promise<ResolvedInstance> {
  const instance = await getPluginInstance(opts.db, opts.instanceId)
  if (!instance) throw new InstanceNotFoundError(opts.instanceId)
  const manifest = opts.registry.manifests().find((m) => m.id === instance.pluginId)
  if (!manifest) throw new UnknownPluginError(instance.pluginId)
  const credentials = instance.credentialsEncrypted
    ? (decryptJson(instance.credentialsEncrypted, opts.encryptionKey) as Record<string, unknown>)
    : {}
  if (manifest.credentialSchema) {
    const validated = validateInstanceInput({ manifest, config: instance.config, credentials })
    return { instance, config: { ...validated.config, ...validated.credentials } }
  }
  // legacy: manifests without a credentialSchema stored secrets in the config union
  const merged = { ...instance.config, ...credentials }
  const parsed = manifest.configSchema.safeParse(merged)
  if (!parsed.success) throw new PluginConfigError(instance.pluginId, parsed.error.issues)
  return { instance, config: parsed.data }
}
