import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { z } from 'zod'
import { pluginKindSchema } from '@smokejumper/plugin-sdk'

const semverPattern = /^\d+\.\d+\.\d+(-[\w.]+)?$/

export const manifestVersionSchema = z.object({
  version: z.string().regex(semverPattern, 'version must be semver'),
  sdkVersion: z.string().regex(semverPattern, 'sdkVersion must be semver'),
  bundleUrl: z.string().url(),
  // digest/signature/signer are bundle-level artifacts produced by Plan 17's
  // scripts/sign-bundle over the real bundle contents. This loader only validates
  // their shape and passes them through unchanged — it never computes or
  // re-verifies them; that is the boot-time loader's job.
  digest: z.string().regex(/^[0-9a-f]{64}$/, 'digest must be a sha256 hex digest'),
  signature: z.string().min(1),
  signer: z.string().min(1),
})

export const manifestEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id must be kebab-case'),
  name: z.string().min(1),
  kind: pluginKindSchema,
  description: z.string().min(1),
  repo: z.string().url(),
  verified: z.boolean(),
  versions: z.array(manifestVersionSchema).min(1),
})

export const registrySourceManifestSchema = z.object({
  entries: z.array(manifestEntrySchema).min(1),
})

export type ManifestVersion = z.infer<typeof manifestVersionSchema>
export type ManifestEntry = z.infer<typeof manifestEntrySchema>
export type RegistrySourceManifest = z.infer<typeof registrySourceManifestSchema>

export function parseRegistryManifest(yamlText: string): RegistrySourceManifest {
  return registrySourceManifestSchema.parse(load(yamlText))
}

export function loadRegistryManifest(path: string): RegistrySourceManifest {
  return parseRegistryManifest(readFileSync(path, 'utf8'))
}
