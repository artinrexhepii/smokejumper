import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadInstalledPlugins } from '../src/loader'
import { createRegistry } from '../src/registry'
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

describe('loadInstalledPlugins', () => {
  it('loads a validly signed bundle into the registry', async () => {
    const pluginsDir = await freshDir()
    const key = createFixtureKeypair('trusted-key')
    await writeFixtureBundle({
      dir: join(pluginsDir, 'good-plugin@0.1.0'),
      id: 'good-plugin',
      keyId: key.keyId,
      privateKey: key.privateKey,
    })
    const registry = createRegistry()
    const report = await loadInstalledPlugins({ registry, dir: pluginsDir, trustKeys: [key.trustKey], logger: quietLogger })
    expect(report.loaded).toEqual(['good-plugin'])
    expect(report.skipped).toEqual([])
    expect(registry.telemetrySource('good-plugin')).toBeDefined()
  })

  it('returns an empty report for a plugins directory that does not exist', async () => {
    const registry = createRegistry()
    const report = await loadInstalledPlugins({
      registry,
      dir: join('/tmp', `sj-missing-${Date.now()}`),
      trustKeys: [],
      logger: quietLogger,
    })
    expect(report).toEqual({ loaded: [], skipped: [] })
  })

  it('returns an empty report for an empty plugins directory', async () => {
    const pluginsDir = await freshDir()
    const registry = createRegistry()
    const report = await loadInstalledPlugins({ registry, dir: pluginsDir, trustKeys: [], logger: quietLogger })
    expect(report).toEqual({ loaded: [], skipped: [] })
  })

  it('isolates a bad bundle so the others still load', async () => {
    const pluginsDir = await freshDir()
    const key = createFixtureKeypair('trusted-key')
    const badKey = createFixtureKeypair('unknown-signer')
    await writeFixtureBundle({
      dir: join(pluginsDir, 'good-plugin@0.1.0'),
      id: 'good-plugin',
      keyId: key.keyId,
      privateKey: key.privateKey,
    })
    await writeFixtureBundle({
      dir: join(pluginsDir, 'bad-plugin@0.1.0'),
      id: 'bad-plugin',
      keyId: badKey.keyId,
      privateKey: badKey.privateKey,
    })
    const registry = createRegistry()
    const report = await loadInstalledPlugins({ registry, dir: pluginsDir, trustKeys: [key.trustKey], logger: quietLogger })
    expect(report.loaded).toEqual(['good-plugin'])
    expect(report.skipped).toEqual([{ bundle: 'bad-plugin@0.1.0', reason: expect.stringContaining('not a pinned trust key') }])
    expect(registry.telemetrySource('good-plugin')).toBeDefined()
    expect(registry.telemetrySource('bad-plugin')).toBeUndefined()
  })

  it('isolates a colliding plugin id so only the first bundle registers', async () => {
    const pluginsDir = await freshDir()
    const key = createFixtureKeypair('trusted-key')
    await writeFixtureBundle({
      dir: join(pluginsDir, 'dup-plugin@1.0.0'),
      id: 'dup-plugin',
      version: '1.0.0',
      keyId: key.keyId,
      privateKey: key.privateKey,
    })
    await writeFixtureBundle({
      dir: join(pluginsDir, 'dup-plugin@2.0.0'),
      id: 'dup-plugin',
      version: '2.0.0',
      keyId: key.keyId,
      privateKey: key.privateKey,
    })
    const registry = createRegistry()
    const report = await loadInstalledPlugins({ registry, dir: pluginsDir, trustKeys: [key.trustKey], logger: quietLogger })
    expect(report.loaded).toHaveLength(1)
    expect(report.skipped).toHaveLength(1)
    expect(report.skipped[0]!.reason).toContain('already registered')
  })
})
