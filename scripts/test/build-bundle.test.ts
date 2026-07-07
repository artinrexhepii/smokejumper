import { generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { bundlePayloadSchema, type BundleManifest } from '@smokejumper/registry'
import { buildBundle } from '../build-bundle.ts'

function testKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string }
  const privJwk = privateKey.export({ format: 'jwk' }) as { d: string }
  const secretKeyBase64 = Buffer.concat([
    Buffer.from(privJwk.d, 'base64url'),
    Buffer.from(pubJwk.x, 'base64url'),
  ]).toString('base64')
  return { secretKeyBase64, publicKey }
}

const manifest: BundleManifest = {
  id: 'demo',
  name: 'Demo',
  version: '0.1.0',
  sdkVersion: '0.2.0',
  kind: 'telemetry-source',
  description: 'demo plugin',
}

const indexMjs = `import { z } from 'zod'
export default function create() {
  return { manifest: { id: 'demo', name: 'Demo', version: '0.1.0', sdkVersion: '0.2.0', kind: 'telemetry-source', description: 'demo plugin', configSchema: z.object({}) }, async healthCheck() { return { ok: true } }, tools() { return [] } }
}
`

describe('buildBundle', () => {
  it('produces a payload, a content digest, and a signature that verifies over the digest', async () => {
    const { secretKeyBase64, publicKey } = testKeypair()
    const built = await buildBundle({ manifest, indexMjs }, { secretKeyBase64, keyId: 'demo-key' })
    expect(built.signer).toBe('demo-key')
    expect(built.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(bundlePayloadSchema.safeParse(built.payload).success).toBe(true)
    expect(verify(null, Buffer.from(built.digest), publicKey, Buffer.from(built.signature, 'base64'))).toBe(true)
  })

  it('changes the digest when the module content changes', async () => {
    const { secretKeyBase64 } = testKeypair()
    const a = await buildBundle({ manifest, indexMjs }, { secretKeyBase64, keyId: 'k' })
    const b = await buildBundle({ manifest, indexMjs: `${indexMjs}\n// changed\n` }, { secretKeyBase64, keyId: 'k' })
    expect(a.digest).not.toBe(b.digest)
  })
})
