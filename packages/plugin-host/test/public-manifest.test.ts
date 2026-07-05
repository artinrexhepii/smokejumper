import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { PluginManifest } from '@smokejumper/plugin-sdk'
import { publicManifest } from '../src/public-manifest'

describe('publicManifest', () => {
  it('strips zod schemas and keeps only JSON-safe manifest fields', () => {
    const manifest: PluginManifest = {
      id: 'demo',
      name: 'Demo',
      version: '1.2.3',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source',
      description: 'demo plugin',
      configSchema: z.object({ url: z.string().url() }),
      credentialSchema: z.object({ token: z.string() }),
    }
    expect(publicManifest(manifest)).toEqual({
      id: 'demo',
      name: 'Demo',
      version: '1.2.3',
      kind: 'telemetry-source',
      description: 'demo plugin',
      sdkVersion: '0.2.0',
    })
  })
})
