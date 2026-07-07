import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { sign as edSign } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleManifestSchema, computeBundleDigest, type BundleManifest } from '@smokejumper/registry'
import { privateKeyFromSecretBase64 } from './sign-index.ts'

export interface BundleInput {
  manifest: BundleManifest
  indexMjs: string
}

export interface BuiltBundle {
  payload: { manifest: BundleManifest; indexMjs: string }
  digest: string
  signature: string
  signer: string
}

// Packages a plugin into the signed bundle the server installs. It lays the
// files out exactly as installBundle will on disk — manifest.json pretty-printed
// with two-space indent, plus index.mjs — so the content digest computed here is
// the same one installBundle and the boot-time loader recompute and check. The
// digest/signature/signer this returns are precisely the values the plugin's
// registry-entry version must carry.
export async function buildBundle(
  input: BundleInput,
  opts: { secretKeyBase64: string; keyId: string },
): Promise<BuiltBundle> {
  const manifest = bundleManifestSchema.parse(input.manifest)
  const stagingDir = mkdtempSync(join(tmpdir(), 'sj-build-bundle-'))
  try {
    writeFileSync(join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    writeFileSync(join(stagingDir, 'index.mjs'), input.indexMjs, 'utf8')
    const { digest } = await computeBundleDigest(stagingDir)
    const privateKey = privateKeyFromSecretBase64(opts.secretKeyBase64)
    const signature = edSign(null, Buffer.from(digest), privateKey).toString('base64')
    return { payload: { manifest, indexMjs: input.indexMjs }, digest, signature, signer: opts.keyId }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false

if (isMain) {
  const [manifestFile, indexFile, outFile] = process.argv.slice(2)
  if (!manifestFile || !indexFile || !outFile) {
    throw new Error('usage: build-bundle.ts <manifest.json> <index.mjs> <out-payload.json>')
  }
  const secretKeyBase64 = process.env.SMOKEJUMPER_REGISTRY_SIGNING_KEY
  if (!secretKeyBase64) throw new Error('SMOKEJUMPER_REGISTRY_SIGNING_KEY is required to sign the bundle')
  const keyId = process.env.SMOKEJUMPER_REGISTRY_SIGNING_KEY_ID
  if (!keyId) throw new Error('SMOKEJUMPER_REGISTRY_SIGNING_KEY_ID is required to sign the bundle')
  const manifest = bundleManifestSchema.parse(JSON.parse(readFileSync(manifestFile, 'utf8')))
  const indexMjs = readFileSync(indexFile, 'utf8')
  const built = await buildBundle({ manifest, indexMjs }, { secretKeyBase64, keyId })
  writeFileSync(outFile, `${JSON.stringify(built.payload, null, 2)}\n`)
  console.log(`built ${outFile}`)
  console.log(`digest=${built.digest}`)
  console.log(`signature=${built.signature}`)
  console.log(`signer=${built.signer}`)
}
