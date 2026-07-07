import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { computeBundleDigest } from '../src/digest'

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sj-digest-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function writeManifestAndIndex(dir: string, indexContent: string): Promise<void> {
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ id: 'demo', version: '1.0.0' }), 'utf8')
  await writeFile(join(dir, 'index.mjs'), indexContent, 'utf8')
}

describe('computeBundleDigest', () => {
  it('computes a stable digest for identical content', async () => {
    const dirA = await tempDir()
    const dirB = await tempDir()
    await writeManifestAndIndex(dirA, 'export default 1')
    await writeManifestAndIndex(dirB, 'export default 1')
    const a = await computeBundleDigest(dirA)
    const b = await computeBundleDigest(dirB)
    expect(a.digest).toBe(b.digest)
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes the digest when file content changes', async () => {
    const dir = await tempDir()
    await writeManifestAndIndex(dir, 'export default 1')
    const before = await computeBundleDigest(dir)
    await writeFile(join(dir, 'index.mjs'), 'export default 2', 'utf8')
    const after = await computeBundleDigest(dir)
    expect(after.digest).not.toBe(before.digest)
  })

  it('excludes bundle.sig and signer.txt from the digest', async () => {
    const dir = await tempDir()
    await writeManifestAndIndex(dir, 'export default 1')
    const before = await computeBundleDigest(dir)
    await writeFile(join(dir, 'bundle.sig'), 'anything', 'utf8')
    await writeFile(join(dir, 'signer.txt'), 'anyone', 'utf8')
    const after = await computeBundleDigest(dir)
    expect(after.digest).toBe(before.digest)
  })

  it('includes files in nested subdirectories', async () => {
    const dir = await tempDir()
    await writeManifestAndIndex(dir, 'export default 1')
    const before = await computeBundleDigest(dir)
    await mkdir(join(dir, 'lib'), { recursive: true })
    await writeFile(join(dir, 'lib', 'helper.mjs'), 'export const x = 1', 'utf8')
    const after = await computeBundleDigest(dir)
    expect(after.digest).not.toBe(before.digest)
  })
})
