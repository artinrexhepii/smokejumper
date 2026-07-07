import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBuiltinRegistry } from '../src/builtin'
import { loadInstalledPlugins } from '../src/loader'
import { verifyBundle } from '../src/bundle'
import { createFixtureKeypair, createTempPluginsDir, writeFixtureBundle } from './helpers/fixture-bundle'

const cleanupDirs: string[] = []
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function freshDir(): Promise<string> {
  const dir = await createTempPluginsDir()
  cleanupDirs.push(dir)
  return dir
}
const quietLogger = { debug() {}, info() {}, warn() {}, error() {} }

describe('registry loader in the assembled system', () => {
  it('loads a real signed plugin into a registry that already holds the built-ins, and it is callable', async () => {
    const pluginsDir = await freshDir()
    const key = createFixtureKeypair('trusted-key')
    await writeFixtureBundle({
      dir: join(pluginsDir, 'installed-fixture@0.1.0'),
      id: 'installed-fixture',
      keyId: key.keyId,
      privateKey: key.privateKey,
    })

    const registry = createBuiltinRegistry()
    const report = await loadInstalledPlugins({ registry, dir: pluginsDir, trustKeys: [key.trustKey], logger: quietLogger })

    expect(report.loaded).toEqual(['installed-fixture'])
    // the built-ins registered before the loader ran are unaffected
    expect(registry.alertSource('webhook')).toBeDefined()

    const source = registry.telemetrySource('installed-fixture')
    expect(source).toBeDefined()
    const health = await source!.healthCheck({
      projectId: 'proj-1',
      config: {},
      signal: new AbortController().signal,
      fetch: globalThis.fetch,
      logger: quietLogger,
    })
    expect(health.ok).toBe(true)

    const tools = source!.tools()
    expect(tools).toHaveLength(1)
    const result = await tools[0]!.execute(
      {},
      {
        projectId: 'proj-1',
        config: {},
        signal: new AbortController().signal,
        fetch: globalThis.fetch,
        logger: quietLogger,
        incidentId: 'inc-1',
      },
    )
    expect(result).toEqual({ summary: 'pong', data: { pong: true } })
  })

  it('proves a tampered copy of a plugin is rejected end-to-end while a valid sibling still loads', async () => {
    const pluginsDir = await freshDir()
    const key = createFixtureKeypair('trusted-key')
    await writeFixtureBundle({
      dir: join(pluginsDir, 'valid-fixture@0.1.0'),
      id: 'valid-fixture',
      keyId: key.keyId,
      privateKey: key.privateKey,
    })
    const tamperedDir = join(pluginsDir, 'tampered-fixture@0.1.0')
    await writeFixtureBundle({ dir: tamperedDir, id: 'tampered-fixture', keyId: key.keyId, privateKey: key.privateKey })
    const preTamperCheck = await verifyBundle(tamperedDir, [key.trustKey])
    expect(preTamperCheck.ok).toBe(true)
    const original = await readFile(join(tamperedDir, 'index.mjs'), 'utf8')
    await writeFile(join(tamperedDir, 'index.mjs'), `${original}\n// tampered\n`, 'utf8')

    const registry = createBuiltinRegistry()
    const report = await loadInstalledPlugins({ registry, dir: pluginsDir, trustKeys: [key.trustKey], logger: quietLogger })

    expect(report.loaded).toEqual(['valid-fixture'])
    expect(report.skipped).toEqual([
      { bundle: 'tampered-fixture@0.1.0', reason: expect.stringContaining('signature verification failed') },
    ])
    expect(registry.telemetrySource('valid-fixture')).toBeDefined()
    expect(registry.telemetrySource('tampered-fixture')).toBeUndefined()
  })
})
