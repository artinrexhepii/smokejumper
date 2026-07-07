import { describe, expect, it } from 'vitest'
import {
  parseTrustKeys,
  publicKeyBase64FromSecret,
  publicKeyFromBase64,
  signIndex,
  verifyIndexSignature,
} from '../sign-index.ts'

// Test fixture only — never the production key. The real first-party private key
// lives solely in the SMOKEJUMPER_REGISTRY_SIGNING_KEY GitHub secret and is never
// committed. This keypair exists only so this file's round trip is real, runnable,
// verifiable cryptography rather than a stubbed assertion. FIXTURE_PUBLIC_B64 is
// the SPKI-DER (base64) public key — the exact wire format packages/registry's
// trust.ts parses — so an index signed here verifies unchanged in the server.
const FIXTURE_SECRET_B64 =
  'CXzYTMnnIo5PORv48xPOhdRDGXGK8n64y4NryNdvyJ4p4q6Ds6wwXykqk95TyYebl9GqpmwnftOKt2UVZMrDIA=='
const FIXTURE_PUBLIC_B64 = 'MCowBQYDK2VwAyEAKeKug7OsMF8pKpPeU8mHm5fRqqZsJ37TirdlFWTKwyA='
const FIXTURE_KEY_ID = 'smokejumper-fixture-2026'

const payload = {
  generatedAt: '2026-07-06T00:00:00.000Z',
  entries: [
    {
      id: 'webhook',
      name: 'Generic Webhook',
      kind: 'alert-source' as const,
      description: 'desc',
      repo: 'https://github.com/artinrexhepi/smokejumper',
      verified: true,
      signals: { stars: 1 },
      versions: [],
    },
  ],
}

describe('signIndex / verifyIndexSignature', () => {
  it('signs and verifies a round trip against the pinned trust key', () => {
    const signed = signIndex(payload, { secretKeyBase64: FIXTURE_SECRET_B64, keyId: FIXTURE_KEY_ID })
    expect(signed.signer).toBe(FIXTURE_KEY_ID)
    expect(signed.generatedAt).toBe(payload.generatedAt)
    const ok = verifyIndexSignature(signed, [{ keyId: FIXTURE_KEY_ID, publicKey: FIXTURE_PUBLIC_B64 }])
    expect(ok).toBe(true)
  })

  it('rejects a tampered index', () => {
    const signed = signIndex(payload, { secretKeyBase64: FIXTURE_SECRET_B64, keyId: FIXTURE_KEY_ID })
    const tampered = { ...signed, entries: [{ ...signed.entries[0]!, verified: false }] }
    const ok = verifyIndexSignature(tampered, [{ keyId: FIXTURE_KEY_ID, publicKey: FIXTURE_PUBLIC_B64 }])
    expect(ok).toBe(false)
  })

  it('rejects when the signer key id is not in the trust list', () => {
    const signed = signIndex(payload, { secretKeyBase64: FIXTURE_SECRET_B64, keyId: FIXTURE_KEY_ID })
    const ok = verifyIndexSignature(signed, [{ keyId: 'someone-else', publicKey: FIXTURE_PUBLIC_B64 }])
    expect(ok).toBe(false)
  })

  it('derives a working public key from its SPKI-DER base64 form', () => {
    const pub = publicKeyFromBase64(FIXTURE_PUBLIC_B64)
    expect(pub.asymmetricKeyType).toBe('ed25519')
  })

  it('derives the trust-key public value from the signing secret', () => {
    expect(publicKeyBase64FromSecret(FIXTURE_SECRET_B64)).toBe(FIXTURE_PUBLIC_B64)
  })
})

describe('parseTrustKeys', () => {
  it('parses a comma-separated keyId:base64PubKey list', () => {
    const parsed = parseTrustKeys(`${FIXTURE_KEY_ID}:${FIXTURE_PUBLIC_B64},other-key:${FIXTURE_PUBLIC_B64}`)
    expect(parsed).toEqual([
      { keyId: FIXTURE_KEY_ID, publicKey: FIXTURE_PUBLIC_B64 },
      { keyId: 'other-key', publicKey: FIXTURE_PUBLIC_B64 },
    ])
  })

  it('throws on a malformed entry', () => {
    expect(() => parseTrustKeys('not-a-valid-entry')).toThrow()
  })
})
