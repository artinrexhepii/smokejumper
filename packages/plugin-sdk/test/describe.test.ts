import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { describeConfig, type PluginManifest } from '../src/index'

function manifest(configSchema: z.ZodTypeAny, credentialSchema?: z.ZodTypeAny): PluginManifest {
  return {
    id: 'demo',
    name: 'Demo',
    version: '0.1.0',
    sdkVersion: '0.2.0',
    kind: 'telemetry-source',
    description: 'demo',
    configSchema,
    ...(credentialSchema ? { credentialSchema } : {}),
  }
}

describe('describeConfig', () => {
  it('describes primitive, url, enum, optional, and default fields', () => {
    const descriptor = describeConfig(
      manifest(
        z.object({
          region: z.string().describe('AWS region'),
          endpoint: z.string().url(),
          retries: z.number(),
          verbose: z.boolean().optional(),
          stat: z.enum(['avg', 'sum']).default('avg'),
        }),
      ),
    )
    expect(descriptor.config).toEqual([
      { key: 'region', type: 'string', required: true, secret: false, description: 'AWS region' },
      { key: 'endpoint', type: 'url', required: true, secret: false },
      { key: 'retries', type: 'number', required: true, secret: false },
      { key: 'verbose', type: 'boolean', required: false, secret: false },
      { key: 'stat', type: 'enum', required: false, secret: false, default: 'avg', enumValues: ['avg', 'sum'] },
    ])
    expect(descriptor.credentials).toEqual([])
  })

  it('marks credentialSchema fields as secret', () => {
    const descriptor = describeConfig(
      manifest(z.object({}), z.object({ token: z.string().describe('API token') })),
    )
    expect(descriptor.config).toEqual([])
    expect(descriptor.credentials).toEqual([
      { key: 'token', type: 'string', required: true, secret: true, description: 'API token' },
    ])
  })

  it('throws on an unsupported field shape', () => {
    expect(() => describeConfig(manifest(z.object({ tags: z.array(z.string()) })))).toThrow()
  })

  it('throws when the schema is not a top-level object', () => {
    expect(() => describeConfig(manifest(z.string() as unknown as z.ZodTypeAny))).toThrow()
  })
})
