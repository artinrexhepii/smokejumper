import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FIRST_PARTY_KEY_ID, resolveTrustKeys } from '../src/first-party-key'

describe('resolveTrustKeys', () => {
  it('always includes the baked-in first-party key even with no env value', () => {
    const keys = resolveTrustKeys(undefined)
    expect(keys.map((k) => k.keyId)).toEqual([FIRST_PARTY_KEY_ID])
  })

  it('additionally includes operator-configured trust keys', () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const base64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
    const keys = resolveTrustKeys(`operator-key:${base64}`)
    expect(keys.map((k) => k.keyId)).toEqual([FIRST_PARTY_KEY_ID, 'operator-key'])
  })
})
