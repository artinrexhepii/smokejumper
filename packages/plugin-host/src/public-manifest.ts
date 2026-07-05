import type { PluginKind, PluginManifest } from '@smokejumper/plugin-sdk'

export function publicManifest(manifest: PluginManifest): {
  id: string
  name: string
  version: string
  kind: PluginKind
  description: string
  sdkVersion: string
} {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    kind: manifest.kind,
    description: manifest.description,
    sdkVersion: manifest.sdkVersion,
  }
}

export type PublicManifest = ReturnType<typeof publicManifest>
