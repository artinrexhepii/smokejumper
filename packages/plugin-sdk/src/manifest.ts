import { z } from 'zod'

export const semverPattern = /^\d+\.\d+\.\d+(-[\w.]+)?$/

export const pluginKindSchema = z.enum([
  'alert-source',
  'telemetry-source',
  'context-source',
  'notification-sink',
  'action-sink',
])

export type PluginKind = z.infer<typeof pluginKindSchema>

export const pluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id must be kebab-case'),
  name: z.string().min(1),
  version: z.string().regex(semverPattern, 'version must be semver'),
  sdkVersion: z.string().regex(semverPattern, 'sdkVersion must be semver'),
  kind: pluginKindSchema,
  description: z.string().min(1),
  configSchema: z.custom<z.ZodTypeAny>((v) => v instanceof z.ZodType, {
    message: 'configSchema must be a zod schema',
  }),
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>
