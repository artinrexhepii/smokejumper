import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { findTrustKey, parseTrustKeys, verifyDetachedSignature } from '../src/trust'

function keypair() {
  return generateKeyPairSync('ed25519')
}

function publicKeyBase64(publicKey: ReturnType<typeof keypair>['publicKey']): string {
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

describe('parseTrustKeys', () => {
  it('returns an empty array for undefined', () => {
    expect(parseTrustKeys(undefined)).toEqual([])
  })

  it('returns an empty array for a blank string', () => {
    expect(parseTrustKeys('   ')).toEqual([])
  })

  it('parses a single keyId:base64PublicKey entry', () => {
    const { publicKey } = keypair()
    const [key] = parseTrustKeys(`k1:${publicKeyBase64(publicKey)}`)
    expect(key!.keyId).toBe('k1')
    expect(key!.publicKey.asymmetricKeyType).toBe('ed25519')
  })

  it('parses multiple comma-separated entries', () => {
    const a = keypair()
    const b = keypair()
    const keys = parseTrustKeys(`k1:${publicKeyBase64(a.publicKey)},k2:${publicKeyBase64(b.publicKey)}`)
    expect(keys.map((k) => k.keyId)).toEqual(['k1', 'k2'])
  })

  it('throws on a malformed entry with no colon', () => {
    expect(() => parseTrustKeys('not-a-valid-entry')).toThrow(/expected "keyId:base64PublicKey"/)
  })
})

describe('findTrustKey', () => {
  it('finds a key by id and returns undefined when missing', () => {
    const { publicKey } = keypair()
    const keys = parseTrustKeys(`k1:${publicKeyBase64(publicKey)}`)
    expect(findTrustKey(keys, 'k1')).toBe(keys[0])
    expect(findTrustKey(keys, 'nope')).toBeUndefined()
  })
})

describe('verifyDetachedSignature', () => {
  it('returns true for a valid signature and false for tampered data, a wrong key, or a garbage signature', () => {
    const { publicKey, privateKey } = keypair()
    const other = keypair()
    const data = 'the-bundle-digest'
    const signature = sign(null, Buffer.from(data, 'utf8'), privateKey).toString('base64')

    expect(verifyDetachedSignature(data, signature, publicKey)).toBe(true)
    expect(verifyDetachedSignature('tampered-digest', signature, publicKey)).toBe(false)
    expect(verifyDetachedSignature(data, signature, other.publicKey)).toBe(false)
    expect(verifyDetachedSignature(data, 'not-a-real-signature', publicKey)).toBe(false)
  })
})
