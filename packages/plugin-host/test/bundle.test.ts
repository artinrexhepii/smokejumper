import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyBundle } from '../src/bundle'
import { createFixtureKeypair, createTempPluginsDir, writeFixtureBundle } from './helpers/fixture-bundle'

const cleanupDirs: string[] = []
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function freshDir(): Promise<string> {
  const dir = await createTempPluginsDir()
  cleanupDirs.push(dir)
  return dir
}

describe('verifyBundle', () => {
  it('accepts a validly signed bundle', async () => {
    const pluginsDir = await freshDir()
    const key = createFixtureKeypair('trusted-key')
    const bundleDir = join(pluginsDir, 'good-plugin@0.1.0')
    await writeFixtureBundle({ dir: bundleDir, id: 'good-plugin', keyId: key.keyId, privateKey: key.privateKey })
    const result = await verifyBundle(bundleDir, [key.trustKey])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.manifest.id).toBe('good-plugin')
  })

  it('rejects an unsigned bundle', async () => {
    const pluginsDir = await freshDir()
    const key = createFixtureKeypair('trusted-key')
    const bundleDir = join(pluginsDir, 'unsigned-plugin@0.1.0')
    await writeFixtureBundle({ dir: bundleDir, id: 'unsigned-plugin', keyId: key.keyId, privateKey: key.privateKey })
    await rm(join(bundleDir, 'bundle.sig'))
    await rm(join(bundleDir, 'signer.txt'))
    const result = await verifyBundle(bundleDir, [key.trustKey])
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('signer.txt') })
  })

  it('rejects a bundle whose signature fails verification', async () => {
    const pluginsDir = await freshDir()
    const key = createFixtureKeypair('trusted-key')
    const bundleDir = join(pluginsDir, 'bad-sig-plugin@0.1.0')
    await writeFixtureBundle({ dir: bundleDir, id: 'bad-sig-plugin', keyId: key.keyId, privateKey: key.privateKey })
    await writeFile(join(bundleDir, 'bundle.sig'), 'not-a-real-signature==', 'utf8')
    const result = await verifyBundle(bundleDir, [key.trustKey])
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('signature verification failed') })
  })

  it('rejects a bundle tampered with after signing', async () => {
    const pluginsDir = await freshDir()
    const key = createFixtureKeypair('trusted-key')
    const bundleDir = join(pluginsDir, 'tampered-plugin@0.1.0')
    await writeFixtureBundle({ dir: bundleDir, id: 'tampered-plugin', keyId: key.keyId, privateKey: key.privateKey })
    const original = await readFile(join(bundleDir, 'index.mjs'), 'utf8')
    await writeFile(join(bundleDir, 'index.mjs'), `${original}\n// one byte changed after signing\n`, 'utf8')
    const result = await verifyBundle(bundleDir, [key.trustKey])
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('signature verification failed') })
  })

  it('rejects a bundle signed by an unknown/untrusted signer', async () => {
    const pluginsDir = await freshDir()
    const untrustedKey = createFixtureKeypair('untrusted-key')
    const trusted = createFixtureKeypair('trusted-key')
    const bundleDir = join(pluginsDir, 'untrusted-plugin@0.1.0')
    await writeFixtureBundle({ dir: bundleDir, id: 'untrusted-plugin', keyId: untrustedKey.keyId, privateKey: untrustedKey.privateKey })
    const result = await verifyBundle(bundleDir, [trusted.trustKey])
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('is not a pinned trust key') })
  })

  it('rejects a malformed manifest (invalid id) even though it is validly signed', async () => {
    const pluginsDir = await freshDir()
    const key = createFixtureKeypair('trusted-key')
    const bundleDir = join(pluginsDir, 'malformed-plugin@0.1.0')
    await writeFixtureBundle({
      dir: bundleDir,
      id: 'malformed-plugin',
      keyId: key.keyId,
      privateKey: key.privateKey,
      manifestOverrides: { id: 'Bad Id!' },
    })
    const result = await verifyBundle(bundleDir, [key.trustKey])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('manifest.json failed validation')
  })

  it('rejects a bundle whose manifest kind is not loadable in this phase', async () => {
    const pluginsDir = await freshDir()
    const key = createFixtureKeypair('trusted-key')
    const bundleDir = join(pluginsDir, 'action-sink-plugin@0.1.0')
    await writeFixtureBundle({
      dir: bundleDir,
      id: 'action-sink-plugin',
      keyId: key.keyId,
      privateKey: key.privateKey,
      kind: 'action-sink',
    })
    const result = await verifyBundle(bundleDir, [key.trustKey])
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('not loadable in this phase') })
  })

  it('rejects a bundle whose sdkVersion is incompatible with the host SDK_VERSION', async () => {
    const pluginsDir = await freshDir()
    const key = createFixtureKeypair('trusted-key')
    const bundleDir = join(pluginsDir, 'old-sdk-plugin@0.1.0')
    await writeFixtureBundle({
      dir: bundleDir,
      id: 'old-sdk-plugin',
      keyId: key.keyId,
      privateKey: key.privateKey,
      manifestOverrides: { sdkVersion: '1.0.0' },
    })
    const result = await verifyBundle(bundleDir, [key.trustKey])
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('incompatible') })
  })
})
