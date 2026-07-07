import { describe, expect, it } from 'vitest'
import { bundleManifestSchema, registryEntrySchema, registryIndexSchema } from '../src/schema'

function validEntry() {
  return {
    id: 'demo-plugin',
    name: 'Demo Plugin',
    kind: 'telemetry-source' as const,
    description: 'a demo plugin',
    repo: 'https://example.com/demo-plugin',
    verified: true,
    signals: {},
    versions: [
      {
        version: '1.0.0',
        sdkVersion: '0.2.0',
        bundleUrl: 'https://example.com/bundles/demo-plugin-1.0.0.json',
        digest: 'a'.repeat(64),
        signature: 'c2ln',
        signer: 'demo-signer',
      },
    ],
  }
}

function validIndex() {
  return {
    generatedAt: '2026-07-06T00:00:00.000Z',
    entries: [validEntry()],
    signature: 'c2ln',
    signer: 'demo-signer',
  }
}

describe('registryIndexSchema and registryEntrySchema', () => {
  it('parses a valid registry index', () => {
    expect(registryIndexSchema.parse(validIndex())).toMatchObject({ signer: 'demo-signer' })
  })

  it('rejects an index missing a signature', () => {
    const { signature, ...withoutSignature } = validIndex()
    expect(() => registryIndexSchema.parse(withoutSignature)).toThrow()
  })

  it('rejects an entry with an invalid (non-kebab-case) id', () => {
    const entry = { ...validEntry(), id: 'Demo_Plugin' }
    expect(() => registryEntrySchema.parse(entry)).toThrow(/kebab-case/)
  })

  it('rejects an entry version with a non-semver version', () => {
    const entry = validEntry()
    entry.versions[0]!.version = 'not-a-version'
    expect(() => registryEntrySchema.parse(entry)).toThrow(/semver/)
  })

  it('rejects an entry with an invalid kind', () => {
    const entry = { ...validEntry(), kind: 'not-a-kind' }
    expect(() => registryEntrySchema.parse(entry)).toThrow()
  })
})

describe('bundleManifestSchema', () => {
  it('accepts the on-disk descriptor fields without configSchema/credentialSchema', () => {
    const manifest = {
      id: 'demo-plugin',
      name: 'Demo Plugin',
      version: '1.0.0',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source',
      description: 'a demo plugin',
    }
    expect(bundleManifestSchema.parse(manifest)).toEqual(manifest)
  })

  it('rejects a descriptor missing required fields', () => {
    const manifest = { id: 'demo-plugin', name: 'Demo Plugin' }
    expect(() => bundleManifestSchema.parse(manifest)).toThrow()
  })
})
