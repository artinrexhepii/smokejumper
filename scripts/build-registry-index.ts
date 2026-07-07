import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { loadRegistryManifest, type RegistrySourceManifest } from './registry-manifest.ts'
import { fetchEntrySignals } from './registry-signals.ts'
import type { RegistryEntry, RegistryIndex } from '@smokejumper/registry'

export interface BuildRegistryIndexOptions {
  manifest: RegistrySourceManifest
  fetchImpl: typeof fetch
  now?: () => string
  githubToken?: string
}

export async function buildRegistryIndex(
  opts: BuildRegistryIndexOptions,
): Promise<Omit<RegistryIndex, 'signature' | 'signer'>> {
  const now = opts.now ?? (() => new Date().toISOString())
  const entries: RegistryEntry[] = []
  for (const source of opts.manifest.entries) {
    const signals = await fetchEntrySignals(source, opts.fetchImpl, { githubToken: opts.githubToken })
    entries.push({
      id: source.id,
      name: source.name,
      kind: source.kind,
      description: source.description,
      repo: source.repo,
      verified: source.verified,
      signals,
      versions: source.versions,
    })
  }
  return { generatedAt: now(), entries }
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false

if (isMain) {
  const manifest = loadRegistryManifest('registry/plugins.yaml')
  const unsigned = await buildRegistryIndex({
    manifest,
    fetchImpl: fetch,
    githubToken: process.env.GITHUB_TOKEN,
  })
  writeFileSync('registry/index.unsigned.json', `${JSON.stringify(unsigned, null, 2)}\n`)
  console.log(`wrote registry/index.unsigned.json with ${unsigned.entries.length} entries`)
}
