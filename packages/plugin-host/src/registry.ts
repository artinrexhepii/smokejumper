import {
  pluginManifestSchema,
  type AlertSource,
  type ContextSource,
  type NotificationSink,
  type PluginKind,
  type PluginManifest,
  type TelemetrySource,
} from '@smokejumper/plugin-sdk'

export type RegisteredPlugin = AlertSource | TelemetrySource | ContextSource | NotificationSink

export interface PluginRegistry {
  register(plugin: RegisteredPlugin): void
  alertSource(id: string): AlertSource | undefined
  telemetrySource(id: string): TelemetrySource | undefined
  notificationSink(id: string): NotificationSink | undefined
  manifests(): PluginManifest[]
}

const loadableKinds = new Set<PluginKind>([
  'alert-source',
  'telemetry-source',
  'context-source',
  'notification-sink',
])

export function isLoadableKind(kind: PluginKind): boolean {
  return loadableKinds.has(kind)
}

export function createRegistry(): PluginRegistry {
  const plugins = new Map<string, RegisteredPlugin>()

  function byKind<T extends RegisteredPlugin>(id: string, kind: PluginKind): T | undefined {
    const plugin = plugins.get(id)
    if (!plugin || plugin.manifest.kind !== kind) return undefined
    return plugin as T
  }

  return {
    register(plugin) {
      const manifest = pluginManifestSchema.parse(plugin.manifest)
      if (!isLoadableKind(manifest.kind)) {
        throw new Error(`plugin kind "${manifest.kind}" is not loadable in this phase`)
      }
      if (plugins.has(manifest.id)) {
        throw new Error(`plugin "${manifest.id}" is already registered`)
      }
      plugins.set(manifest.id, plugin)
    },
    alertSource: (id) => byKind<AlertSource>(id, 'alert-source'),
    telemetrySource: (id) => byKind<TelemetrySource>(id, 'telemetry-source'),
    notificationSink: (id) => byKind<NotificationSink>(id, 'notification-sink'),
    manifests: () => [...plugins.values()].map((plugin) => plugin.manifest),
  }
}
