import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installBundle, type RegistryEntry, type TrustKey } from '@smokejumper/registry'
import { createBuiltinRegistry, loadInstalledPlugins } from '@smokejumper/plugin-host'
import { buildBundle } from '../build-bundle.ts'

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} }

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function testKeypair(keyId: string): { secretKeyBase64: string; trustKey: TrustKey } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string }
  const privJwk = privateKey.export({ format: 'jwk' }) as { d: string }
  const secretKeyBase64 = Buffer.concat([
    Buffer.from(privJwk.d, 'base64url'),
    Buffer.from(pubJwk.x, 'base64url'),
  ]).toString('base64')
  return { secretKeyBase64, trustKey: { keyId, publicKey } }
}

const manifest = {
  id: 'demo-metrics',
  name: 'Demo Metrics',
  version: '0.1.0',
  sdkVersion: '0.2.0',
  kind: 'telemetry-source' as const,
  description: 'a demonstration telemetry source installed from a signed bundle',
}

// A portable module: the bare `import 'zod'` resolves to the host's own zod
// instance at load time (the install dir sits under the app's node_modules
// ancestry), so the host's `configSchema instanceof z.ZodType` manifest check
// passes without embedding any build-machine path.
const indexMjs = `import { z } from 'zod'
export default function create() {
  return {
    manifest: {
      id: 'demo-metrics',
      name: 'Demo Metrics',
      version: '0.1.0',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source',
      description: 'a demonstration telemetry source installed from a signed bundle',
      configSchema: z.object({}),
    },
    async healthCheck() {
      return { ok: true }
    },
    tools() {
      return [
        {
          name: 'ping',
          description: 'returns a fixed pong',
          inputSchema: z.object({}),
          scope: 'read',
          costHint: 'cheap',
          latencyHintMs: 1,
          async execute() {
            return { summary: 'pong', data: { pong: true } }
          },
        },
      ]
    },
  }
}
`

function entryFor(digest: string, signature: string, signer: string): RegistryEntry {
  return {
    id: 'demo-metrics',
    name: 'Demo Metrics',
    kind: 'telemetry-source',
    description: manifest.description,
    repo: 'https://github.com/artinrexhepii/smokejumper',
    verified: true,
    signals: {},
    versions: [
      { version: '0.1.0', sdkVersion: '0.2.0', bundleUrl: 'https://example.test/demo-metrics.json', digest, signature, signer },
    ],
  }
}

describe('install-and-load end to end', () => {
  it('builds, installs, and loads a real signed bundle through the actual machinery, and its tool runs', async () => {
    const { secretKeyBase64, trustKey } = testKeypair('e2e-signer')
    const built = await buildBundle({ manifest, indexMjs }, { secretKeyBase64, keyId: 'e2e-signer' })
    const fetchImpl = (async () =>
      new Response(JSON.stringify(built.payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch
    const entry = entryFor(built.digest, built.signature, 'e2e-signer')

    const dir = await mkdtemp(join(process.cwd(), '.plugins-e2e-'))
    cleanup.push(dir)

    await installBundle({ entry, version: '0.1.0', dir, trustKeys: [trustKey], fetchImpl })

    const registry = createBuiltinRegistry()
    const report = await loadInstalledPlugins({ registry, dir, trustKeys: [trustKey], logger: quietLogger })

    expect(report.loaded).toEqual(['demo-metrics'])
    expect(report.skipped).toEqual([])
    expect(registry.alertSource('webhook')).toBeDefined()

    const source = registry.telemetrySource('demo-metrics')
    expect(source).toBeDefined()
    const ctx = {
      projectId: 'proj-1',
      config: {},
      signal: new AbortController().signal,
      fetch: globalThis.fetch,
      logger: quietLogger,
      incidentId: 'inc-1',
    }
    const health = await source!.healthCheck(ctx)
    expect(health.ok).toBe(true)
    const result = await source!.tools()[0]!.execute({}, ctx)
    expect(result).toEqual({ summary: 'pong', data: { pong: true } })
  })

  it('refuses to install a bundle whose content does not match the registry digest', async () => {
    const { secretKeyBase64, trustKey } = testKeypair('e2e-signer')
    const built = await buildBundle({ manifest, indexMjs }, { secretKeyBase64, keyId: 'e2e-signer' })
    const tampered = { manifest: built.payload.manifest, indexMjs: `${built.payload.indexMjs}\n// tampered\n` }
    const fetchImpl = (async () =>
      new Response(JSON.stringify(tampered), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch
    const entry = entryFor(built.digest, built.signature, 'e2e-signer')

    const dir = await mkdtemp(join(process.cwd(), '.plugins-e2e-'))
    cleanup.push(dir)

    await expect(
      installBundle({ entry, version: '0.1.0', dir, trustKeys: [trustKey], fetchImpl }),
    ).rejects.toThrow(/does not match the registry digest/)
  })
})
