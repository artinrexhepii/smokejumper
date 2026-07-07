import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installBundle } from '../src/install'
import type { RegistryEntry } from '../src/schema'
import { createTestKeypair, signVersion } from '../src/testing'

const cleanupDirs: string[] = []
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sj-install-'))
  cleanupDirs.push(dir)
  return dir
}

function baseManifest() {
  return {
    id: 'installed-plugin',
    name: 'Installed Plugin',
    version: '1.0.0',
    sdkVersion: '0.2.0',
    kind: 'telemetry-source' as const,
    description: 'a plugin to install',
  }
}

const BUNDLE_URL = 'https://example.test/bundles/installed-plugin-1.0.0.json'

function fakeFetch(payload: unknown, url = BUNDLE_URL): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const requested = typeof input === 'string' ? input : input.toString()
    if (requested !== url) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(payload), { status: 200 })
  }) as typeof fetch
}

async function entryFor(manifest = baseManifest()) {
  const key = createTestKeypair('install-signer')
  const signed = await signVersion({
    manifest,
    indexMjs: 'export default function create() { return {} }\n',
    privateKey: key.privateKey,
  })
  const entry: RegistryEntry = {
    id: manifest.id,
    name: manifest.name,
    kind: manifest.kind,
    description: 'a plugin to install',
    repo: 'https://example.test/installed-plugin',
    verified: true,
    signals: {},
    versions: [
      {
        version: manifest.version,
        sdkVersion: manifest.sdkVersion,
        bundleUrl: BUNDLE_URL,
        digest: signed.digest,
        signature: signed.signature,
        signer: key.keyId,
      },
    ],
  }
  return { entry, key, signed }
}

describe('installBundle', () => {
  it('installs a bundle whose fetched payload matches the pinned digest and signature', async () => {
    const dir = await freshDir()
    const { entry, key, signed } = await entryFor()
    await installBundle({ entry, version: '1.0.0', dir, trustKeys: [key.trustKey], fetchImpl: fakeFetch(signed.bundlePayload) })
    const installedDir = join(dir, 'installed-plugin@1.0.0')
    expect(await readdir(installedDir)).toEqual(['bundle.sig', 'index.mjs', 'manifest.json', 'signer.txt'])
    expect(await readFile(join(installedDir, 'signer.txt'), 'utf8')).toBe(key.keyId)
  })

  it('rejects an unknown version not present on the entry', async () => {
    const dir = await freshDir()
    const { entry, key, signed } = await entryFor()
    await expect(
      installBundle({ entry, version: '9.9.9', dir, trustKeys: [key.trustKey], fetchImpl: fakeFetch(signed.bundlePayload) }),
    ).rejects.toThrow(/no published version/)
  })

  it('rejects a version signed by an untrusted signer without fetching the bundle', async () => {
    const dir = await freshDir()
    const { entry, signed } = await entryFor()
    let fetchCalled = false
    const fetchImpl = (async () => {
      fetchCalled = true
      return new Response(JSON.stringify(signed.bundlePayload))
    }) as typeof fetch
    const otherKey = createTestKeypair('someone-else')
    await expect(
      installBundle({ entry, version: '1.0.0', dir, trustKeys: [otherKey.trustKey], fetchImpl }),
    ).rejects.toThrow(/not a pinned trust key/)
    expect(fetchCalled).toBe(false)
  })

  it('rejects a fetched payload that does not match the pinned digest and leaves nothing on disk', async () => {
    const dir = await freshDir()
    const { entry, key, signed } = await entryFor()
    const tamperedPayload = { ...signed.bundlePayload, indexMjs: 'export default function create() { return { evil: true } }\n' }
    await expect(
      installBundle({ entry, version: '1.0.0', dir, trustKeys: [key.trustKey], fetchImpl: fakeFetch(tamperedPayload) }),
    ).rejects.toThrow(/does not match the registry digest/)
    expect(await readdir(dir)).toEqual([])
  })

  it('rejects a payload whose signature fails verification even though fetched intact', async () => {
    const dir = await freshDir()
    const { entry, key, signed } = await entryFor()
    entry.versions[0]!.signature = 'AAAAnot-a-real-signature=='
    await expect(
      installBundle({ entry, version: '1.0.0', dir, trustKeys: [key.trustKey], fetchImpl: fakeFetch(signed.bundlePayload) }),
    ).rejects.toThrow(/signature verification failed/)
  })

  it('replaces an existing install directory cleanly on reinstall', async () => {
    const dir = await freshDir()
    const { entry, key, signed } = await entryFor()
    await installBundle({ entry, version: '1.0.0', dir, trustKeys: [key.trustKey], fetchImpl: fakeFetch(signed.bundlePayload) })
    await installBundle({ entry, version: '1.0.0', dir, trustKeys: [key.trustKey], fetchImpl: fakeFetch(signed.bundlePayload) })
    expect(await readdir(dir)).toEqual(['installed-plugin@1.0.0'])
  })
})
