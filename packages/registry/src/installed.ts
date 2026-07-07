import { readdir } from 'node:fs/promises'

export interface InstalledBundle {
  id: string
  version: string
}

export async function listInstalledBundles(dir: string): Promise<InstalledBundle[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const bundles: InstalledBundle[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const at = entry.name.lastIndexOf('@')
    if (at <= 0) continue
    bundles.push({ id: entry.name.slice(0, at), version: entry.name.slice(at + 1) })
  }
  return bundles
}
