import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadRegistryIndex, resolveVersion } from '../src/client'
import { FIRST_PARTY_INDEX_PATH, resolveTrustKeys } from '../src/first-party-key'
import type { RegistryEntry } from '../src/schema'
import { createTestKeypair, signRegistryIndex } from '../src/testing'

function fakeFetch(responses: Map<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = responses.get(url)
    if (body === undefined) return new Response('not found', { status: 404 })
    return new Response(body, { status: 200 })
  }) as typeof fetch
}

function demoEntry(): RegistryEntry {
  return {
    id: 'demo-plugin',
    name: 'Demo Plugin',
    kind: 'telemetry-source',
    description: 'demo',
    repo: 'https://example.test/demo-plugin',
    verified: true,
    signals: {},
    versions: [
      {
        version: '1.0.0',
        sdkVersion: '0.2.0',
        bundleUrl: 'https://example.test/bundles/demo-plugin-1.0.0.json',
        digest: 'a'.repeat(64),
        signature: 'unused-in-these-tests',
        signer: 'demo-signer',
      },
    ],
  }
}

const INDEX_URL = 'https://example.test/registry/index.json'

describe('loadRegistryIndex', () => {
  it('loads and verifies a signed index fetched from a url', async () => {
    const key = createTestKeypair('index-signer')
    const index = signRegistryIndex({ entries: [demoEntry()], privateKey: key.privateKey, signer: key.keyId })
    const fetchImpl = fakeFetch(new Map([[INDEX_URL, JSON.stringify(index)]]))
    const loaded = await loadRegistryIndex({ bundledPath: '/unused', url: INDEX_URL, trustKeys: [key.trustKey], fetchImpl })
    expect(loaded.entries).toHaveLength(1)
    expect(loaded.entries[0]!.id).toBe('demo-plugin')
  })

  it('rejects an index whose signature does not match (tampered entries)', async () => {
    const key = createTestKeypair('index-signer')
    const index = signRegistryIndex({ entries: [demoEntry()], privateKey: key.privateKey, signer: key.keyId })
    const tampered = { ...index, entries: [{ ...demoEntry(), verified: false }] }
    const fetchImpl = fakeFetch(new Map([[INDEX_URL, JSON.stringify(tampered)]]))
    await expect(
      loadRegistryIndex({ bundledPath: '/unused', url: INDEX_URL, trustKeys: [key.trustKey], fetchImpl }),
    ).rejects.toThrow(/signature verification failed/)
  })

  it('rejects an index signed by an untrusted signer', async () => {
    const key = createTestKeypair('index-signer')
    const other = createTestKeypair('other-key')
    const index = signRegistryIndex({ entries: [demoEntry()], privateKey: key.privateKey, signer: key.keyId })
    const fetchImpl = fakeFetch(new Map([[INDEX_URL, JSON.stringify(index)]]))
    await expect(
      loadRegistryIndex({ bundledPath: '/unused', url: INDEX_URL, trustKeys: [other.trustKey], fetchImpl }),
    ).rejects.toThrow(/not a pinned trust key/)
  })

  it('rejects malformed JSON', async () => {
    const key = createTestKeypair('index-signer')
    const fetchImpl = fakeFetch(new Map([[INDEX_URL, '{not json']]))
    await expect(
      loadRegistryIndex({ bundledPath: '/unused', url: INDEX_URL, trustKeys: [key.trustKey], fetchImpl }),
    ).rejects.toThrow(/not valid JSON/)
  })

  it('rejects an index that fails schema validation', async () => {
    const key = createTestKeypair('index-signer')
    const fetchImpl = fakeFetch(new Map([[INDEX_URL, JSON.stringify({ generatedAt: 'x' })]]))
    await expect(
      loadRegistryIndex({ bundledPath: '/unused', url: INDEX_URL, trustKeys: [key.trustKey], fetchImpl }),
    ).rejects.toThrow(/schema validation/)
  })

  it('loads and verifies a signed index from a bundled file path when no url is set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sj-index-'))
    const key = createTestKeypair('index-signer')
    const index = signRegistryIndex({ entries: [demoEntry()], privateKey: key.privateKey, signer: key.keyId })
    const path = join(dir, 'index.json')
    await writeFile(path, JSON.stringify(index), 'utf8')
    const loaded = await loadRegistryIndex({ bundledPath: path, trustKeys: [key.trustKey] })
    expect(loaded.entries).toHaveLength(1)
    await rm(dir, { recursive: true, force: true })
  })

  it('loads and verifies the real committed first-party bundled index with the baked-in trust key', async () => {
    const loaded = await loadRegistryIndex({ bundledPath: FIRST_PARTY_INDEX_PATH, trustKeys: resolveTrustKeys(undefined) })
    expect(loaded.entries).toEqual([])
  })
})

describe('resolveVersion', () => {
  function entryWithVersions(versions: string[]): RegistryEntry {
    const base = demoEntry()
    return { ...base, versions: versions.map((version) => ({ ...base.versions[0]!, version })) }
  }

  it('resolves the highest version satisfying a caret range', () => {
    const entry = entryWithVersions(['1.0.0', '1.2.0', '2.0.0'])
    expect(resolveVersion(entry, '^1.0.0')?.version).toBe('1.2.0')
  })

  it('resolves the highest version satisfying a >= range', () => {
    const entry = entryWithVersions(['1.0.0', '1.2.0', '2.0.0'])
    expect(resolveVersion(entry, '>=2.0.0')?.version).toBe('2.0.0')
  })

  it('returns undefined when no version satisfies the constraint', () => {
    const entry = entryWithVersions(['1.0.0', '1.2.0'])
    expect(resolveVersion(entry, '^3.0.0')).toBeUndefined()
  })

  it('resolves an exact version constraint', () => {
    const entry = entryWithVersions(['1.0.0', '1.2.0'])
    expect(resolveVersion(entry, '1.0.0')?.version).toBe('1.0.0')
  })

  it('excludes prerelease versions from a stable range by default', () => {
    const entry = entryWithVersions(['1.0.0', '1.1.0-beta.1'])
    expect(resolveVersion(entry, '^1.0.0')?.version).toBe('1.0.0')
  })
})
