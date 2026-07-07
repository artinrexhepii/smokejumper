import { createPublicKey, verify, type KeyObject } from 'node:crypto'

export interface TrustKey {
  keyId: string
  publicKey: KeyObject
}

export function parseTrustKeys(raw: string | undefined): TrustKey[] {
  if (!raw || raw.trim() === '') return []
  return raw.split(',').map((entry) => {
    const trimmed = entry.trim()
    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex <= 0) {
      throw new Error(`invalid trust key entry "${trimmed}", expected "keyId:base64PublicKey"`)
    }
    const keyId = trimmed.slice(0, separatorIndex)
    const base64PublicKey = trimmed.slice(separatorIndex + 1)
    const publicKey = createPublicKey({
      key: Buffer.from(base64PublicKey, 'base64'),
      format: 'der',
      type: 'spki',
    })
    return { keyId, publicKey }
  })
}

export function findTrustKey(trustKeys: TrustKey[], keyId: string): TrustKey | undefined {
  return trustKeys.find((key) => key.keyId === keyId)
}

export function verifyDetachedSignature(data: string, signatureBase64: string, publicKey: KeyObject): boolean {
  try {
    // Ed25519 has its own internal hashing; node:crypto requires a null
    // algorithm here (verified against Node 22 — the string 'ed25519' throws).
    return verify(null, Buffer.from(data, 'utf8'), publicKey, Buffer.from(signatureBase64, 'base64'))
  } catch {
    return false
  }
}
