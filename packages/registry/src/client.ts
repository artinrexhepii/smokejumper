import { readFile } from 'node:fs/promises'
import { canonicalJson } from '@smokejumper/db'
import semver from 'semver'
import { registryIndexSchema, type RegistryEntry, type RegistryIndex } from './schema'
import { findTrustKey, verifyDetachedSignature, type TrustKey } from './trust'

export interface LoadRegistryIndexOptions {
  bundledPath: string
  url?: string
  trustKeys: TrustKey[]
  fetchImpl?: typeof fetch
}

async function fetchIndexText(url: string, fetchImpl?: typeof fetch): Promise<string> {
  const impl = fetchImpl ?? globalThis.fetch
  const res = await impl(url)
  if (!res.ok) throw new Error(`failed to fetch registry index from ${url}: ${res.status}`)
  return res.text()
}

export async function loadRegistryIndex(opts: LoadRegistryIndexOptions): Promise<RegistryIndex> {
  const raw = opts.url ? await fetchIndexText(opts.url, opts.fetchImpl) : await readFile(opts.bundledPath, 'utf8')

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    throw new Error(`registry index is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const parsed = registryIndexSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`registry index failed schema validation: ${parsed.error.message}`)
  }
  const index = parsed.data

  const trustKey = findTrustKey(opts.trustKeys, index.signer)
  if (!trustKey) {
    throw new Error(`registry index signer "${index.signer}" is not a pinned trust key`)
  }
  const signingInput = canonicalJson({ generatedAt: index.generatedAt, entries: index.entries })
  if (!verifyDetachedSignature(signingInput, index.signature, trustKey.publicKey)) {
    throw new Error('registry index signature verification failed')
  }

  return index
}

export function resolveVersion(entry: RegistryEntry, constraint: string): RegistryEntry['versions'][number] | undefined {
  const versions = entry.versions.map((v) => v.version)
  const best = semver.maxSatisfying(versions, constraint)
  if (!best) return undefined
  return entry.versions.find((v) => v.version === best)
}
