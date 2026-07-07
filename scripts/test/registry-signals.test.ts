import { describe, expect, it, vi } from 'vitest'
import { fetchEntrySignals, fetchGithubSignals, fetchNpmSignals } from '../registry-signals.ts'
import type { ManifestEntry } from '../registry-manifest.ts'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('fetchGithubSignals', () => {
  it('reads stargazer count and the latest release date', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === 'https://api.github.com/repos/artinrexhepi/smokejumper') {
        return jsonResponse(200, { stargazers_count: 123 })
      }
      if (url.startsWith('https://api.github.com/repos/artinrexhepi/smokejumper/releases')) {
        return jsonResponse(200, [{ published_at: '2026-06-01T00:00:00.000Z' }])
      }
      throw new Error(`unexpected url ${url}`)
    })
    const signals = await fetchGithubSignals('https://github.com/artinrexhepi/smokejumper', fetchImpl)
    expect(signals.stars).toBe(123)
    expect(signals.lastReleaseAt).toBe('2026-06-01T00:00:00.000Z')
  })

  it('sends an authorization header when a github token is provided', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { stargazers_count: 1 }),
    )
    await fetchGithubSignals('https://github.com/a/b', fetchImpl, { token: 'ghp_test' })
    const init = fetchImpl.mock.calls[0]![1] as RequestInit
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer ghp_test')
  })

  it('returns no signals for a non-github repo url', async () => {
    const fetchImpl = vi.fn()
    const signals = await fetchGithubSignals('https://gitlab.com/a/b', fetchImpl)
    expect(signals).toEqual({})
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('is non-fatal when the github api errors', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}))
    const signals = await fetchGithubSignals('https://github.com/a/b', fetchImpl)
    expect(signals).toEqual({})
  })

  it('is non-fatal when fetch itself throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down')
    })
    const signals = await fetchGithubSignals('https://github.com/a/b', fetchImpl)
    expect(signals).toEqual({})
  })
})

describe('fetchNpmSignals', () => {
  it('reads last-month downloads and the maintainer name', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('api.npmjs.org')) return jsonResponse(200, { downloads: 42 })
      if (url.includes('registry.npmjs.org')) return jsonResponse(200, { maintainers: [{ name: 'octocat' }] })
      throw new Error(`unexpected url ${url}`)
    })
    const signals = await fetchNpmSignals('some-package', fetchImpl)
    expect(signals.downloads).toBe(42)
    expect(signals.maintainer).toBe('octocat')
  })

  it('is non-fatal for an unpublished package', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {}))
    const signals = await fetchNpmSignals('@smokejumper/plugin-webhook', fetchImpl)
    expect(signals).toEqual({})
  })
})

describe('fetchEntrySignals', () => {
  const entry: ManifestEntry = {
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
        bundleUrl: 'https://example.com/x.tar.gz',
        digest: 'd'.repeat(64),
        signature: 'sig',
        signer: 'k',
      },
    ],
  }

  it('combines github signals with npm signals when a package name is given', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('api.github.com/repos') && !url.includes('releases')) return jsonResponse(200, { stargazers_count: 5 })
      if (url.includes('releases')) return jsonResponse(200, [])
      if (url.includes('api.npmjs.org')) return jsonResponse(200, { downloads: 9 })
      if (url.includes('registry.npmjs.org')) return jsonResponse(200, {})
      throw new Error(`unexpected url ${url}`)
    })
    const signals = await fetchEntrySignals(entry, fetchImpl, { npmPackageName: 'some-pkg' })
    expect(signals).toEqual({ stars: 5, downloads: 9 })
  })

  it('omits npm signals entirely when no package name is given', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('releases')) return jsonResponse(200, [])
      return jsonResponse(200, { stargazers_count: 2 })
    })
    const signals = await fetchEntrySignals(entry, fetchImpl)
    expect(signals).toEqual({ stars: 2 })
    for (const call of fetchImpl.mock.calls) {
      expect(call[0]!.toString()).not.toContain('npmjs')
    }
  })
})
