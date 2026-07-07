import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SDK_VERSION } from '@smokejumper/plugin-sdk'
import {
  bundleManifestSchema,
  computeBundleDigest,
  findTrustKey,
  verifyDetachedSignature,
  type BundleManifest,
  type TrustKey,
} from '@smokejumper/registry'
import { isLoadableKind } from './registry'

export type VerifyBundleResult = { ok: true; manifest: BundleManifest } | { ok: false; reason: string }

function sdkMajor(version: string): string {
  return version.split('.')[0] ?? version
}

export async function verifyBundle(dir: string, trustKeys: TrustKey[]): Promise<VerifyBundleResult> {
  // Step 1: pinned-key check, before any hashing — an untrusted signer can
  // never pass regardless of digest/signature, so reject cheaply and first.
  let signer: string
  try {
    signer = (await readFile(join(dir, 'signer.txt'), 'utf8')).trim()
  } catch {
    return { ok: false, reason: 'missing signer.txt (unsigned bundle)' }
  }
  const trustKey = findTrustKey(trustKeys, signer)
  if (!trustKey) {
    return { ok: false, reason: `signer "${signer}" is not a pinned trust key` }
  }

  // Step 2: recompute the bundle digest (reads manifest.json as part of it).
  let digest: string
  let rawManifest: unknown
  try {
    ;({ digest, manifest: rawManifest } = await computeBundleDigest(dir))
  } catch (err) {
    return { ok: false, reason: `failed to read bundle contents: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Step 3: verify bundle.sig over that digest. Any post-signing tamper changes
  // the digest, which invalidates the previously-computed signature here.
  let signature: string
  try {
    signature = (await readFile(join(dir, 'bundle.sig'), 'utf8')).trim()
  } catch {
    return { ok: false, reason: 'missing bundle.sig (unsigned bundle)' }
  }
  if (!verifyDetachedSignature(digest, signature, trustKey.publicKey)) {
    return { ok: false, reason: 'signature verification failed (tampered or forged bundle)' }
  }

  // Step 4: validate the on-disk manifest — never inspect the module to do this.
  const parsedManifest = bundleManifestSchema.safeParse(rawManifest)
  if (!parsedManifest.success) {
    return { ok: false, reason: `manifest.json failed validation: ${parsedManifest.error.message}` }
  }
  if (!isLoadableKind(parsedManifest.data.kind)) {
    return { ok: false, reason: `plugin kind "${parsedManifest.data.kind}" is not loadable in this phase` }
  }
  if (sdkMajor(parsedManifest.data.sdkVersion) !== sdkMajor(SDK_VERSION)) {
    return {
      ok: false,
      reason: `manifest sdkVersion "${parsedManifest.data.sdkVersion}" is incompatible with host SDK_VERSION "${SDK_VERSION}"`,
    }
  }
  // Step 5 (dynamic import + registry.register()) is deliberately NOT here —
  // it belongs to the loader (Task 4), which only reaches it after this
  // function returns { ok: true }.
  return { ok: true, manifest: parsedManifest.data }
}
