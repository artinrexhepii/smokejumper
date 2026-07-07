import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { computeBundleDigest, type TrustKey } from '@smokejumper/registry'

export interface FixtureKeypair {
  keyId: string
  privateKey: KeyObject
  trustKey: TrustKey
}

export function createFixtureKeypair(keyId: string): FixtureKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { keyId, privateKey, trustKey: { keyId, publicKey } }
}

export async function createTempPluginsDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sj-plugins-'))
}

export interface WriteFixtureBundleOptions {
  dir: string
  id: string
  keyId: string
  privateKey: KeyObject
  version?: string
  kind?: string
  manifestOverrides?: Record<string, unknown>
}

export async function writeFixtureBundle(opts: WriteFixtureBundleOptions): Promise<void> {
  const manifest: Record<string, unknown> = {
    id: opts.id,
    name: `Fixture ${opts.id}`,
    version: opts.version ?? '0.1.0',
    sdkVersion: '0.2.0',
    kind: opts.kind ?? 'telemetry-source',
    description: `fixture plugin ${opts.id}`,
    ...opts.manifestOverrides,
  }
  // Resolved once, here, inside the repo's own module resolution chain, so the
  // generated index.mjs can later be dynamically imported from a temp directory
  // that has no node_modules ancestry of its own. createRequire (not
  // import.meta.resolve, which is not a function under vitest's SSR transform)
  // gives a real absolute path we turn into a file:// URL to embed.
  const zodUrl = pathToFileURL(createRequire(import.meta.url).resolve('zod')).href
  const indexMjsSource = `import { z } from ${JSON.stringify(zodUrl)}

export default function create() {
  return {
    manifest: {
      id: ${JSON.stringify(manifest.id)},
      name: ${JSON.stringify(manifest.name)},
      version: ${JSON.stringify(manifest.version)},
      sdkVersion: ${JSON.stringify(manifest.sdkVersion)},
      kind: ${JSON.stringify(manifest.kind)},
      description: ${JSON.stringify(manifest.description)},
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
  await mkdir(opts.dir, { recursive: true })
  await writeFile(join(opts.dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  await writeFile(join(opts.dir, 'index.mjs'), indexMjsSource, 'utf8')
  const { digest } = await computeBundleDigest(opts.dir)
  const signature = sign(null, Buffer.from(digest, 'utf8'), opts.privateKey).toString('base64')
  await writeFile(join(opts.dir, 'bundle.sig'), signature, 'utf8')
  await writeFile(join(opts.dir, 'signer.txt'), opts.keyId, 'utf8')
}
