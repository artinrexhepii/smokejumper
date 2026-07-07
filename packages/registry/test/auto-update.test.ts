import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyAutoUpdates, planAutoUpdates } from '../src/auto-update'
import type { RegistryEntry, RegistryIndex } from '../src/schema'
import { createTestKeypair, signRegistryIndex, signVersion } from '../src/testing'

function entry(id: string, versions: Array<{ version: string; signer: string }>): RegistryEntry {
  return {
    id,
    name: id,
    kind: 'telemetry-source',
    description: id,
    repo: `https://example.test/${id}`,
    verified: true,
    signals: {},
    versions: versions.map((v) => ({
      version: v.version,
      sdkVersion: '0.2.0',
      bundleUrl: `https://example.test/${id}-${v.version}.json`,
      digest: 'a'.repeat(64),
      signature: 'sig',
      signer: v.signer,
    })),
  }
}

function indexOf(entries: RegistryEntry[]): RegistryIndex {
  return { generatedAt: new Date().toISOString(), entries, signature: 'sig', signer: 'index-signer' }
}

describe('planAutoUpdates', () => {
  it('proposes a newer trusted version for an installed plugin', () => {
    const trusted = createTestKeypair('trusted')
    const index = indexOf([
      entry('demo', [
        { version: '1.0.0', signer: 'trusted' },
        { version: '1.1.0', signer: 'trusted' },
      ]),
    ])
    const candidates = planAutoUpdates([{ id: 'demo', version: '1.0.0' }], index, [trusted.trustKey])
    expect(candidates).toEqual([{ id: 'demo', fromVersion: '1.0.0', toVersion: '1.1.0' }])
  })

  it('proposes nothing when already on the latest version', () => {
    const trusted = createTestKeypair('trusted')
    const index = indexOf([entry('demo', [{ version: '1.0.0', signer: 'trusted' }])])
    const candidates = planAutoUpdates([{ id: 'demo', version: '1.0.0' }], index, [trusted.trustKey])
    expect(candidates).toEqual([])
  })

  it('never proposes a version signed by an untrusted signer, even if newer', () => {
    const trusted = createTestKeypair('trusted')
    const index = indexOf([
      entry('demo', [
        { version: '1.0.0', signer: 'trusted' },
        { version: '2.0.0', signer: 'someone-else' },
      ]),
    ])
    const candidates = planAutoUpdates([{ id: 'demo', version: '1.0.0' }], index, [trusted.trustKey])
    expect(candidates).toEqual([])
  })

  it('skips a plugin that is installed but no longer present in the index', () => {
    const trusted = createTestKeypair('trusted')
    const candidates = planAutoUpdates([{ id: 'gone', version: '1.0.0' }], indexOf([]), [trusted.trustKey])
    expect(candidates).toEqual([])
  })
})

describe('applyAutoUpdates', () => {
  const cleanupDirs: string[] = []
  afterEach(async () => {
    await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('installs every planned candidate to disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sj-autoupdate-'))
    cleanupDirs.push(dir)
    const trusted = createTestKeypair('trusted')

    const manifest = {
      id: 'demo',
      name: 'demo',
      version: '1.1.0',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source' as const,
      description: 'demo',
    }
    const signed = await signVersion({
      manifest,
      indexMjs: 'export default function create() { return {} }\n',
      privateKey: trusted.privateKey,
    })
    const bundleUrl = 'https://example.test/demo-1.1.0.json'
    const entryWithBundle = entry('demo', [{ version: '1.1.0', signer: 'trusted' }])
    entryWithBundle.versions[0]!.digest = signed.digest
    entryWithBundle.versions[0]!.signature = signed.signature
    entryWithBundle.versions[0]!.bundleUrl = bundleUrl
    const index = signRegistryIndex({ entries: [entryWithBundle], privateKey: trusted.privateKey, signer: trusted.keyId })

    const indexPath = join(dir, 'index.json')
    await writeFile(indexPath, JSON.stringify(index), 'utf8')
    await mkdir(join(dir, 'demo@1.0.0'), { recursive: true }) // pretend 1.0.0 is already installed

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === bundleUrl) return new Response(JSON.stringify(signed.bundlePayload))
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const applied = await applyAutoUpdates({ dir, bundledIndexPath: indexPath, trustKeys: [trusted.trustKey], fetchImpl })
    expect(applied).toEqual([{ id: 'demo', fromVersion: '1.0.0', toVersion: '1.1.0' }])
    expect(await readdir(dir)).toEqual(expect.arrayContaining(['demo@1.0.0', 'demo@1.1.0']))
  })
})
