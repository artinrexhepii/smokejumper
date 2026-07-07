import { describe, expect, it, vi } from 'vitest'
import { buildRegistryIndex } from '../build-registry-index.ts'
import type { RegistrySourceManifest } from '../registry-manifest.ts'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const manifest: RegistrySourceManifest = {
  entries: [
    {
      id: 'webhook',
      name: 'Generic Webhook',
      kind: 'alert-source',
      description: 'desc',
      repo: 'https://github.com/artinrexhepi/smokejumper',
      verified: true,
      versions: [
        {
          version: '0.1.0',
          sdkVersion: '0.2.0',
          bundleUrl: 'https://example.com/webhook-0.1.0.tar.gz',
          digest: 'd'.repeat(64),
          signature: 'sig',
          signer: 'smokejumper-fixture-2026',
        },
      ],
    },
  ],
}

describe('buildRegistryIndex', () => {
  it('assembles entries with fetched signals and a generatedAt timestamp', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('releases')) return jsonResponse(200, [])
      return jsonResponse(200, { stargazers_count: 7 })
    })
    const unsigned = await buildRegistryIndex({
      manifest,
      fetchImpl,
      now: () => '2026-07-06T00:00:00.000Z',
    })
    expect(unsigned.generatedAt).toBe('2026-07-06T00:00:00.000Z')
    expect(unsigned.entries).toHaveLength(1)
    expect(unsigned.entries[0]!.id).toBe('webhook')
    expect(unsigned.entries[0]!.signals).toEqual({ stars: 7 })
    expect(unsigned.entries[0]!.versions).toEqual(manifest.entries[0]!.versions)
  })

  it('never calls npm endpoints for entries with no configured npm package', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('releases')) return jsonResponse(200, [])
      return jsonResponse(200, {})
    })
    await buildRegistryIndex({ manifest, fetchImpl })
    for (const call of fetchImpl.mock.calls) {
      expect(call[0]!.toString()).not.toContain('npmjs')
    }
  })
})
