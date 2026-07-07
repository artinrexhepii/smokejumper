import { z } from 'zod'
import { pluginKindSchema, pluginManifestSchema, semverPattern } from '@smokejumper/plugin-sdk'

// manifest.json cannot contain configSchema/credentialSchema — those are zod
// schema instances constructed at runtime inside index.mjs, not JSON data.
export const bundleManifestSchema = pluginManifestSchema.omit({
  configSchema: true,
  credentialSchema: true,
})
export type BundleManifest = z.infer<typeof bundleManifestSchema>

export const registryEntryVersionSchema = z.object({
  version: z.string().regex(semverPattern, 'version must be semver'),
  sdkVersion: z.string().regex(semverPattern, 'sdkVersion must be semver'),
  bundleUrl: z.string().min(1),
  digest: z.string().regex(/^[0-9a-f]{64}$/, 'digest must be a sha256 hex string'),
  signature: z.string().min(1),
  signer: z.string().min(1),
})
export type RegistryEntryVersion = z.infer<typeof registryEntryVersionSchema>

export const registrySignalsSchema = z.object({
  stars: z.number().optional(),
  downloads: z.number().optional(),
  lastReleaseAt: z.string().optional(),
  maintainer: z.string().optional(),
})
export type RegistrySignals = z.infer<typeof registrySignalsSchema>

export const registryEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id must be kebab-case'),
  name: z.string().min(1),
  kind: pluginKindSchema,
  description: z.string().min(1),
  repo: z.string().min(1),
  verified: z.boolean(),
  signals: registrySignalsSchema,
  versions: z.array(registryEntryVersionSchema).min(1),
})
export type RegistryEntry = z.infer<typeof registryEntrySchema>

export const registryIndexSchema = z.object({
  generatedAt: z.string(),
  entries: z.array(registryEntrySchema),
  signature: z.string().min(1),
  signer: z.string().min(1),
})
export type RegistryIndex = z.infer<typeof registryIndexSchema>
