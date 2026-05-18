import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { pluginManifestSchema } from '../src/manifest'

const valid = {
  id: 'sentry',
  name: 'Sentry',
  version: '0.1.0',
  sdkVersion: '0.1.0',
  kind: 'alert-source',
  description: 'Ingests Sentry issue alert webhooks',
  configSchema: z.object({ clientSecret: z.string() }),
}

describe('pluginManifestSchema', () => {
  it('accepts a valid manifest', () => {
    expect(pluginManifestSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects ids that are not kebab-case', () => {
    expect(pluginManifestSchema.safeParse({ ...valid, id: 'Bad Id!' }).success).toBe(false)
  })

  it('rejects non-semver versions', () => {
    expect(pluginManifestSchema.safeParse({ ...valid, version: 'one' }).success).toBe(false)
    expect(pluginManifestSchema.safeParse({ ...valid, sdkVersion: '1.0' }).success).toBe(false)
  })

  it('rejects unknown kinds', () => {
    expect(pluginManifestSchema.safeParse({ ...valid, kind: 'webhook' }).success).toBe(false)
  })

  it('rejects a configSchema that is not a zod schema', () => {
    expect(pluginManifestSchema.safeParse({ ...valid, configSchema: { type: 'object' } }).success).toBe(false)
  })
})
