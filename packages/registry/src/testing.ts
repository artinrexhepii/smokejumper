import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson } from '@smokejumper/db'
import { computeBundleDigest } from './digest'
import type { BundleManifest, RegistryEntryVersion, RegistryIndex } from './schema'
import type { TrustKey } from './trust'

export interface TestKeypair {
  keyId: string
  publicKey: KeyObject
  privateKey: KeyObject
  trustKey: TrustKey
}

export function createTestKeypair(keyId: string): TestKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { keyId, publicKey, privateKey, trustKey: { keyId, publicKey } }
}

export interface SignedVersionFixture {
  digest: string
  signature: string
  bundlePayload: { manifest: BundleManifest; indexMjs: string }
}

export async function signVersion(opts: {
  manifest: BundleManifest
  indexMjs: string
  privateKey: KeyObject
}): Promise<SignedVersionFixture> {
  const stagingDir = await mkdtemp(join(tmpdir(), 'sj-registry-sign-'))
  try {
    await writeFile(join(stagingDir, 'manifest.json'), JSON.stringify(opts.manifest, null, 2), 'utf8')
    await writeFile(join(stagingDir, 'index.mjs'), opts.indexMjs, 'utf8')
    const { digest } = await computeBundleDigest(stagingDir)
    const signature = sign(null, Buffer.from(digest, 'utf8'), opts.privateKey).toString('base64')
    return { digest, signature, bundlePayload: { manifest: opts.manifest, indexMjs: opts.indexMjs } }
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

export function buildRegistryEntryVersion(opts: {
  version: string
  sdkVersion: string
  bundleUrl: string
  signed: SignedVersionFixture
  signer: string
}): RegistryEntryVersion {
  return {
    version: opts.version,
    sdkVersion: opts.sdkVersion,
    bundleUrl: opts.bundleUrl,
    digest: opts.signed.digest,
    signature: opts.signed.signature,
    signer: opts.signer,
  }
}

export function signRegistryIndex(opts: {
  entries: RegistryIndex['entries']
  privateKey: KeyObject
  signer: string
  generatedAt?: string
}): RegistryIndex {
  const generatedAt = opts.generatedAt ?? new Date().toISOString()
  const signingInput = canonicalJson({ generatedAt, entries: opts.entries })
  const signature = sign(null, Buffer.from(signingInput, 'utf8'), opts.privateKey).toString('base64')
  return { generatedAt, entries: opts.entries, signature, signer: opts.signer }
}
