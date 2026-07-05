import { describeConfig } from '@smokejumper/plugin-sdk'
import { publicManifest, type PluginRegistry } from '@smokejumper/plugin-host'
import type { FastifyInstance } from 'fastify'

export interface PluginCatalogDeps {
  registry: PluginRegistry
}

export function registerPluginCatalogRoute(app: FastifyInstance, deps: PluginCatalogDeps): void {
  app.get('/api/plugins', async () =>
    deps.registry.manifests().map((manifest) => ({
      manifest: publicManifest(manifest),
      descriptor: describeConfig(manifest),
    })),
  )
}
