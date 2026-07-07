import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto'
import { canonicalJson } from '@smokejumper/db'
import type { RegistryIndex } from '@smokejumper/registry'

// A trust key as carried in SMOKEJUMPER_PLUGIN_TRUST_KEYS: a keyId and the
// SPKI-DER (base64) public key. This is deliberately NOT @smokejumper/registry's
// TrustKey — that type carries an already-imported node:crypto KeyObject, whereas
// this CLI operates on the raw env-string form. The publicKey encoding here is
// the exact SPKI-DER base64 that packages/registry/src/trust.ts parses, so an
// index signed by this script verifies unchanged against the same trust key the
// boot-time loader and registry client pin.
export interface TrustKey {
  keyId: string
  publicKey: string
}

// Ed25519 "secret key" here is the standard 64-byte libsodium/NaCl encoding:
// 32-byte seed followed by its 32-byte public key. Node's JWK import requires
// both `d` (seed) and `x` (public) for a private OKP key, so the combined form
// is what the SMOKEJUMPER_REGISTRY_SIGNING_KEY secret carries, base64-encoded.
// This is the production signing key and must never be committed — the fixture
// keypair in sign-index.test.ts stands in for it in the runnable round trip.
export function privateKeyFromSecretBase64(secretKeyBase64: string): KeyObject {
  const raw = Buffer.from(secretKeyBase64, 'base64')
  if (raw.length !== 64) {
    throw new Error('signing key must decode to 64 bytes (32-byte seed + 32-byte public key)')
  }
  const d = raw.subarray(0, 32).toString('base64url')
  const x = raw.subarray(32, 64).toString('base64url')
  return createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x, d }, format: 'jwk' })
}

export function publicKeyFromBase64(publicKeyBase64: string): KeyObject {
  return createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' })
}

// The SPKI-DER (base64) public key paired with a NaCl secret — the exact value
// an operator stores in the SMOKEJUMPER_PLUGIN_TRUST_KEYS variable so the server
// trusts indexes this key signs.
export function publicKeyBase64FromSecret(secretKeyBase64: string): string {
  const publicKey = createPublicKey(privateKeyFromSecretBase64(secretKeyBase64))
  return publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
}

function indexDigestPayload(index: Pick<RegistryIndex, 'generatedAt' | 'entries'>): Buffer {
  return Buffer.from(canonicalJson({ generatedAt: index.generatedAt, entries: index.entries }))
}

export function signIndex(
  payload: Omit<RegistryIndex, 'signature' | 'signer'>,
  opts: { secretKeyBase64: string; keyId: string },
): RegistryIndex {
  const privateKey = privateKeyFromSecretBase64(opts.secretKeyBase64)
  const signature = edSign(null, indexDigestPayload(payload), privateKey).toString('base64')
  return { ...payload, signature, signer: opts.keyId }
}

export function verifyIndexSignature(index: RegistryIndex, trustKeys: TrustKey[]): boolean {
  const trusted = trustKeys.find((key) => key.keyId === index.signer)
  if (!trusted) return false
  try {
    return edVerify(null, indexDigestPayload(index), publicKeyFromBase64(trusted.publicKey), Buffer.from(index.signature, 'base64'))
  } catch {
    return false
  }
}

export function parseTrustKeys(value: string): TrustKey[] {
  return value.split(',').map((pair) => {
    const [keyId, publicKey] = pair.split(':')
    if (!keyId || !publicKey) throw new Error(`invalid trust key entry: ${pair}`)
    return { keyId, publicKey }
  })
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false

if (isMain) {
  const [cmd, ...args] = process.argv.slice(2)
  if (cmd === 'sign') {
    const [inFile, outFile] = args
    if (!inFile || !outFile) throw new Error('usage: sign-index.ts sign <inFile> <outFile>')
    const secretKeyBase64 = process.env.SMOKEJUMPER_REGISTRY_SIGNING_KEY
    if (!secretKeyBase64) throw new Error('SMOKEJUMPER_REGISTRY_SIGNING_KEY is required to sign the index')
    const keyId = process.env.SMOKEJUMPER_REGISTRY_SIGNING_KEY_ID
    if (!keyId) throw new Error('SMOKEJUMPER_REGISTRY_SIGNING_KEY_ID is required to sign the index')
    const unsigned = JSON.parse(readFileSync(inFile, 'utf8')) as Omit<RegistryIndex, 'signature' | 'signer'>
    const signed = signIndex(unsigned, { secretKeyBase64, keyId })
    writeFileSync(outFile, `${JSON.stringify(signed, null, 2)}\n`)
    console.log(`signed ${outFile} as ${keyId}`)
  } else if (cmd === 'verify') {
    const [file] = args
    if (!file) throw new Error('usage: sign-index.ts verify <file>')
    const trustKeysEnv = process.env.SMOKEJUMPER_PLUGIN_TRUST_KEYS
    if (!trustKeysEnv) throw new Error('SMOKEJUMPER_PLUGIN_TRUST_KEYS is required to verify the index')
    const index = JSON.parse(readFileSync(file, 'utf8')) as RegistryIndex
    const ok = verifyIndexSignature(index, parseTrustKeys(trustKeysEnv))
    if (!ok) {
      console.error(`signature verification failed for ${file}`)
      process.exit(1)
    }
    console.log(`signature ok, signer=${index.signer}`)
  } else {
    console.error('usage: sign-index.ts <sign <in> <out> | verify <file>>')
    process.exit(1)
  }
}
