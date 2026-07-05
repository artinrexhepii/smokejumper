import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createOrganization,
  createPluginInstance,
  createProject,
  createTestDb,
} from '@smokejumper/db'
import type { AlertSource, PluginManifest } from '@smokejumper/plugin-sdk'
import { PluginConfigError } from '../src/errors'
import { createRegistry } from '../src/registry'
import { resolveInstance } from '../src/resolve'
import { validateInstanceInput } from '../src/validate'

const encryptionKey = Buffer.alloc(32, 1).toString('base64')

function manifest(): PluginManifest {
  return {
    id: 'split',
    name: 'Split',
    version: '0.1.0',
    sdkVersion: '0.2.0',
    kind: 'alert-source',
    description: 'demo',
    configSchema: z.object({ channel: z.string() }),
    credentialSchema: z.object({ token: z.string() }),
  }
}

describe('validateInstanceInput', () => {
  it('validates config and credentials against their schemas', () => {
    const result = validateInstanceInput({
      manifest: manifest(),
      config: { channel: '#a' },
      credentials: { token: 't' },
    })
    expect(result).toEqual({ config: { channel: '#a' }, credentials: { token: 't' } })
  })

  it('throws PluginConfigError when config is invalid', () => {
    expect(() =>
      validateInstanceInput({ manifest: manifest(), config: {}, credentials: { token: 't' } }),
    ).toThrow(PluginConfigError)
  })

  it('throws PluginConfigError when a credential is missing', () => {
    expect(() =>
      validateInstanceInput({ manifest: manifest(), config: { channel: '#a' }, credentials: {} }),
    ).toThrow(/token/)
  })

  it('returns empty credentials when the manifest has no credentialSchema', () => {
    const noSecrets: PluginManifest = { ...manifest(), credentialSchema: undefined }
    const result = validateInstanceInput({
      manifest: noSecrets,
      config: { channel: '#a' },
      credentials: { token: 't' },
    })
    expect(result).toEqual({ config: { channel: '#a' }, credentials: {} })
  })
})

describe('resolveInstance credential split', () => {
  it('validates config and credentials separately and merges them', async () => {
    const db = await createTestDb()
    const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
    const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
    const registry = createRegistry()
    const source: AlertSource<{ channel: string; token: string }> = {
      manifest: manifest(),
      async verify() {
        return true
      },
      normalize() {
        return []
      },
    }
    registry.register(source)
    const instance = await createPluginInstance(db, {
      projectId: project.id,
      pluginId: 'split',
      kind: 'alert-source',
      name: 'Split',
      config: { channel: '#a' },
      credentials: { token: 't' },
      encryptionKey,
    })
    const { config } = await resolveInstance({ db, encryptionKey, registry, instanceId: instance.id })
    expect(config).toEqual({ channel: '#a', token: 't' })
  })
})
