import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { computeBundleDigest } from './digest'
import { bundleManifestSchema, type RegistryEntry } from './schema'
import { findTrustKey, verifyDetachedSignature, type TrustKey } from './trust'

export const bundlePayloadSchema = z.object({
  manifest: bundleManifestSchema,
  indexMjs: z.string().min(1),
})
export type BundlePayload = z.infer<typeof bundlePayloadSchema>

export interface InstallBundleOptions {
  entry: RegistryEntry
  version: string
  dir: string
  trustKeys: TrustKey[]
  fetchImpl?: typeof fetch
}

export async function installBundle(opts: InstallBundleOptions): Promise<void> {
  const versionEntry = opts.entry.versions.find((v) => v.version === opts.version)
  if (!versionEntry) {
    throw new Error(`plugin "${opts.entry.id}" has no published version "${opts.version}"`)
  }
  // Check trust before ever fetching — an untrusted signer never justifies a
  // network call to an arbitrary bundleUrl.
  const trustKey = findTrustKey(opts.trustKeys, versionEntry.signer)
  if (!trustKey) {
    throw new Error(`signer "${versionEntry.signer}" for "${opts.entry.id}@${opts.version}" is not a pinned trust key`)
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const res = await fetchImpl(versionEntry.bundleUrl)
  if (!res.ok) {
    throw new Error(`failed to fetch bundle for "${opts.entry.id}@${opts.version}" from ${versionEntry.bundleUrl}: ${res.status}`)
  }
  const payload = bundlePayloadSchema.parse(await res.json())

  await mkdir(opts.dir, { recursive: true })
  const stagingDir = join(opts.dir, `.staging-${opts.entry.id}@${opts.version}-${randomUUID()}`)
  await mkdir(stagingDir, { recursive: true })
  try {
    await writeFile(join(stagingDir, 'manifest.json'), JSON.stringify(payload.manifest, null, 2), 'utf8')
    await writeFile(join(stagingDir, 'index.mjs'), payload.indexMjs, 'utf8')

    const { digest } = await computeBundleDigest(stagingDir)
    if (digest !== versionEntry.digest) {
      throw new Error(`fetched bundle for "${opts.entry.id}@${opts.version}" does not match the registry digest (tampered in transit)`)
    }
    if (!verifyDetachedSignature(digest, versionEntry.signature, trustKey.publicKey)) {
      throw new Error(`signature verification failed for "${opts.entry.id}@${opts.version}"`)
    }

    await writeFile(join(stagingDir, 'bundle.sig'), versionEntry.signature, 'utf8')
    await writeFile(join(stagingDir, 'signer.txt'), versionEntry.signer, 'utf8')

    const finalDir = join(opts.dir, `${opts.entry.id}@${opts.version}`)
    await rm(finalDir, { recursive: true, force: true })
    await rename(stagingDir, finalDir)
  } catch (err) {
    await rm(stagingDir, { recursive: true, force: true })
    throw err
  }
}
