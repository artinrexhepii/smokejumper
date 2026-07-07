import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { canonicalJson, sha256hex } from '@smokejumper/db'

const DIGEST_EXCLUDED_FILES = new Set(['bundle.sig', 'signer.txt'])

export interface BundleDigestResult {
  digest: string
  manifest: unknown
}

async function listFilesRecursive(root: string, dir: string = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(root, full)))
    } else {
      files.push(full)
    }
  }
  return files
}

export async function computeBundleDigest(dir: string): Promise<BundleDigestResult> {
  const manifestRaw = await readFile(join(dir, 'manifest.json'), 'utf8')
  const manifest: unknown = JSON.parse(manifestRaw)
  const allFiles = await listFilesRecursive(dir)
  const files: Array<{ path: string; sha256hex: string }> = []
  for (const filePath of allFiles) {
    const relPath = relative(dir, filePath).split(sep).join('/')
    if (DIGEST_EXCLUDED_FILES.has(relPath)) continue
    const content = await readFile(filePath, 'utf8')
    files.push({ path: relPath, sha256hex: sha256hex(content) })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  const digest = sha256hex(canonicalJson({ files, manifest }))
  return { digest, manifest }
}
