import type { PluginManifest } from '@smokejumper/plugin-sdk'
import { PluginConfigError } from './errors'

export function validateInstanceInput(input: {
  manifest: PluginManifest
  config: unknown
  credentials: unknown
}): { config: Record<string, unknown>; credentials: Record<string, unknown> } {
  const configResult = input.manifest.configSchema.safeParse(input.config ?? {})
  if (!configResult.success) {
    throw new PluginConfigError(input.manifest.id, configResult.error.issues)
  }
  let credentials: Record<string, unknown> = {}
  if (input.manifest.credentialSchema) {
    const credentialResult = input.manifest.credentialSchema.safeParse(input.credentials ?? {})
    if (!credentialResult.success) {
      throw new PluginConfigError(input.manifest.id, credentialResult.error.issues)
    }
    credentials = credentialResult.data as Record<string, unknown>
  }
  return { config: configResult.data as Record<string, unknown>, credentials }
}
