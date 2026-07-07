import { createPublicKey } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseTrustKeys, type TrustKey } from './trust'

export const FIRST_PARTY_KEY_ID = 'smokejumper-first-party-2026'
export const FIRST_PARTY_PUBLIC_KEY_BASE64 = 'MCowBQYDK2VwAyEARGmKqIkM6G2hVnfgpad9Xwbglul1ay6VLwAHD+EMG3I='

// Resolves relative to this file's own location — works unbundled (tsx/vitest,
// where import.meta.url is packages/registry/src/first-party-key.ts) and
// bundled (tsup inlines @smokejumper/* into dist/main.js, so import.meta.url
// becomes the bundle's own path and this still resolves one level up from
// dist/, exactly like packages/db's migrations path).
export const FIRST_PARTY_INDEX_PATH = fileURLToPath(new URL('../first-party-index.json', import.meta.url))

export function firstPartyTrustKey(): TrustKey {
  return {
    keyId: FIRST_PARTY_KEY_ID,
    publicKey: createPublicKey({
      key: Buffer.from(FIRST_PARTY_PUBLIC_KEY_BASE64, 'base64'),
      format: 'der',
      type: 'spki',
    }),
  }
}

export function resolveTrustKeys(raw: string | undefined): TrustKey[] {
  return [firstPartyTrustKey(), ...parseTrustKeys(raw)]
}
