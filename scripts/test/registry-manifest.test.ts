import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadRegistryManifest, parseRegistryManifest, registrySourceManifestSchema } from '../registry-manifest.ts'

const validYaml = `
entries:
  - id: webhook
    name: Generic Webhook
    kind: alert-source
    description: Ingests alerts from any system that can POST JSON with a shared token
    repo: https://github.com/artinrexhepi/smokejumper
    verified: true
    versions:
      - version: 0.1.0
        sdkVersion: 0.2.0
        bundleUrl: https://github.com/artinrexhepi/smokejumper/releases/download/plugin-webhook-v0.1.0/webhook-0.1.0.bundle.tar.gz
        digest: ${'d'.repeat(64)}
        signature: c2ln
        signer: smokejumper-fixture-2026
`

let tmpDir: string | undefined

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  tmpDir = undefined
})

describe('parseRegistryManifest', () => {
  it('parses a valid manifest into typed entries', () => {
    const manifest = parseRegistryManifest(validYaml)
    expect(manifest.entries).toHaveLength(1)
    expect(manifest.entries[0]!.id).toBe('webhook')
    expect(manifest.entries[0]!.kind).toBe('alert-source')
    expect(manifest.entries[0]!.versions[0]!.digest).toHaveLength(64)
  })

  it('rejects an entry id that is not kebab-case', () => {
    const bad = validYaml.replace('id: webhook', 'id: Webhook')
    expect(() => parseRegistryManifest(bad)).toThrow()
  })

  it('rejects a kind outside the plugin-sdk enum', () => {
    const bad = validYaml.replace('kind: alert-source', 'kind: not-a-kind')
    expect(() => parseRegistryManifest(bad)).toThrow()
  })

  it('rejects a digest that is not a 64-char hex string', () => {
    const bad = validYaml.replace(/digest: [0-9a-f]{64}/, 'digest: too-short')
    expect(() => parseRegistryManifest(bad)).toThrow()
  })

  it('rejects an entry with an empty versions array', () => {
    const bad = validYaml.replace(/versions:\n {6}- version: 0\.1\.0[\s\S]*$/, 'versions: []\n')
    expect(() => parseRegistryManifest(bad)).toThrow()
  })

  it('exposes the raw schema for reuse by build-registry-index', () => {
    expect(registrySourceManifestSchema.safeParse({ entries: [] }).success).toBe(false)
  })
})

describe('loadRegistryManifest', () => {
  it('reads and parses a manifest file from disk', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'registry-manifest-'))
    const path = join(tmpDir, 'plugins.yaml')
    writeFileSync(path, validYaml)
    const manifest = loadRegistryManifest(path)
    expect(manifest.entries[0]!.id).toBe('webhook')
  })
})
