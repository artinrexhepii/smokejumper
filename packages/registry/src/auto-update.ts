import { installBundle } from './install'
import { listInstalledBundles } from './installed'
import { loadRegistryIndex, resolveVersion } from './client'
import { findTrustKey, type TrustKey } from './trust'
import type { RegistryIndex } from './schema'

export interface AutoUpdateCandidate {
  id: string
  fromVersion: string
  toVersion: string
}

export function planAutoUpdates(
  installed: Array<{ id: string; version: string }>,
  index: RegistryIndex,
  trustKeys: TrustKey[],
): AutoUpdateCandidate[] {
  const candidates: AutoUpdateCandidate[] = []
  for (const current of installed) {
    const entry = index.entries.find((e) => e.id === current.id)
    if (!entry) continue
    const newer = resolveVersion(entry, `>${current.version}`)
    if (!newer) continue
    if (!findTrustKey(trustKeys, newer.signer)) continue
    candidates.push({ id: current.id, fromVersion: current.version, toVersion: newer.version })
  }
  return candidates
}

export interface ApplyAutoUpdatesOptions {
  dir: string
  bundledIndexPath: string
  registryUrl?: string
  trustKeys: TrustKey[]
  fetchImpl?: typeof fetch
}

export async function applyAutoUpdates(opts: ApplyAutoUpdatesOptions): Promise<AutoUpdateCandidate[]> {
  const installed = await listInstalledBundles(opts.dir)
  const index = await loadRegistryIndex({
    bundledPath: opts.bundledIndexPath,
    url: opts.registryUrl,
    trustKeys: opts.trustKeys,
    fetchImpl: opts.fetchImpl,
  })
  const candidates = planAutoUpdates(installed, index, opts.trustKeys)
  for (const candidate of candidates) {
    const entry = index.entries.find((e) => e.id === candidate.id)!
    await installBundle({ entry, version: candidate.toVersion, dir: opts.dir, trustKeys: opts.trustKeys, fetchImpl: opts.fetchImpl })
  }
  return candidates
}
