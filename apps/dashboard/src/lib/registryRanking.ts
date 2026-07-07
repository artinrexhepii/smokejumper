import type { PluginKind, RegistryEntryView, RegistryVersionView } from './api'

export type KindFilter = PluginKind | 'all'

export function matchesQuery(entry: RegistryEntryView, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return (
    entry.name.toLowerCase().includes(q) ||
    entry.id.toLowerCase().includes(q) ||
    entry.description.toLowerCase().includes(q)
  )
}

export function rankRegistryEntries(
  entries: RegistryEntryView[],
  opts: { query: string; kind: KindFilter },
): RegistryEntryView[] {
  return entries
    .filter((entry) => opts.kind === 'all' || entry.kind === opts.kind)
    .filter((entry) => matchesQuery(entry, opts.query))
    .slice()
    .sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1
      const starsA = a.signals.stars ?? 0
      const starsB = b.signals.stars ?? 0
      if (starsA !== starsB) return starsB - starsA
      return a.name.localeCompare(b.name)
    })
}

function versionParts(version: string): number[] {
  return version
    .split('-')[0]!
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const a = versionParts(current)
  const b = versionParts(candidate)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (bi !== ai) return bi > ai
  }
  return false
}

export function latestVersion(entry: RegistryEntryView): RegistryVersionView {
  return entry.versions.reduce((latest, next) => (isNewerVersion(latest.version, next.version) ? next : latest))
}
