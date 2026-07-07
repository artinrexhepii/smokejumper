import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { computeBundleDigest, type TrustKey } from '@smokejumper/registry'

// The generated index.mjs must import the SAME zod module instance the host
// loaded (plugin-sdk imports 'zod' via its ESM "import" condition). If the
// plugin loads zod's CJS build instead, its z.ZodType is a different class and
// the host's `v instanceof z.ZodType` manifest check fails (dual-package
// hazard). createRequire resolves the CJS entry, so we walk up to zod's
// package.json and take its "import" (ESM) entry explicitly.
function resolveZodEsmUrl(): string {
  const require = createRequire(import.meta.url)
  const cjsEntry = require.resolve('zod')
  let dir = dirname(cjsEntry)
  for (let i = 0; i < 6; i++) {
    const pkgJson = join(dir, 'package.json')
    if (existsSync(pkgJson)) {
      const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'))
      if (pkg.name === 'zod') {
        const esmEntry = pkg.exports?.['.']?.import ?? pkg.module ?? pkg.main
        if (typeof esmEntry === 'string') return pathToFileURL(join(dir, esmEntry)).href
        break
      }
    }
    dir = dirname(dir)
  }
  return pathToFileURL(cjsEntry).href
}

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
  // that has no node_modules ancestry of its own.
  const zodUrl = resolveZodEsmUrl()
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
