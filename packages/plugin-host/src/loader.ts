import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PluginLogger } from '@smokejumper/plugin-sdk'
import type { TrustKey } from '@smokejumper/registry'
import { verifyBundle } from './bundle'
import { createPluginLogger } from './context'
import type { PluginRegistry, RegisteredPlugin } from './registry'

export interface LoadReport {
  loaded: string[]
  skipped: Array<{ bundle: string; reason: string }>
}

export interface LoadInstalledPluginsOptions {
  registry: PluginRegistry
  dir: string
  trustKeys: TrustKey[]
  logger?: PluginLogger
}

export async function loadInstalledPlugins(opts: LoadInstalledPluginsOptions): Promise<LoadReport> {
  const logger = opts.logger ?? createPluginLogger('registry-loader')
  const report: LoadReport = { loaded: [], skipped: [] }

  let entries
  try {
    entries = await readdir(opts.dir, { withFileTypes: true })
  } catch {
    // No plugins directory yet — nothing to load, not an error.
    return report
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const bundleDir = join(opts.dir, entry.name)

    const verified = await verifyBundle(bundleDir, opts.trustKeys)
    if (!verified.ok) {
      logger.warn(`skipping plugin bundle "${entry.name}": ${verified.reason}`)
      report.skipped.push({ bundle: entry.name, reason: verified.reason })
      continue
    }

    try {
      const moduleUrl = pathToFileURL(join(bundleDir, 'index.mjs')).href
      const imported = (await import(moduleUrl)) as { default?: unknown }
      const factory = imported.default as (() => RegisteredPlugin) | undefined
      if (typeof factory !== 'function') {
        throw new Error('index.mjs must default-export a factory function')
      }
      const plugin = factory()
      opts.registry.register(plugin)
      report.loaded.push(verified.manifest.id)
      logger.info(`loaded plugin bundle "${entry.name}" (${verified.manifest.id}@${verified.manifest.version})`)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      logger.warn(`skipping plugin bundle "${entry.name}": ${reason}`)
      report.skipped.push({ bundle: entry.name, reason })
    }
  }

  return report
}
