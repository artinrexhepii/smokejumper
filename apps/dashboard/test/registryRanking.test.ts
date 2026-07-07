import { describe, expect, it } from 'vitest'
import { isNewerVersion, latestVersion, rankRegistryEntries } from '../src/lib/registryRanking'
import type { RegistryEntryView, RegistryVersionView } from '../src/lib/api'

function version(overrides: Partial<RegistryVersionView> = {}): RegistryVersionView {
  return {
    version: '0.1.0',
    sdkVersion: '0.2.0',
    bundleUrl: 'https://example.com/x.tar.gz',
    digest: 'd'.repeat(64),
    signature: 's',
    signer: 'k',
    ...overrides,
  }
}

function entry(overrides: Partial<RegistryEntryView> = {}): RegistryEntryView {
  return {
    id: 'x',
    name: 'X',
    kind: 'telemetry-source',
    description: 'desc',
    repo: 'https://github.com/artinrexhepi/smokejumper',
    verified: false,
    signals: {},
    versions: [version()],
    ...overrides,
  }
}

describe('rankRegistryEntries', () => {
  it('filters by kind', () => {
    const entries = [entry({ id: 'a', kind: 'alert-source' }), entry({ id: 'b', kind: 'telemetry-source' })]
    expect(rankRegistryEntries(entries, { query: '', kind: 'alert-source' }).map((e) => e.id)).toEqual(['a'])
  })

  it('filters by a case-insensitive query across name, id, and description', () => {
    const entries = [entry({ id: 'webhook', name: 'Generic Webhook' }), entry({ id: 'slack', name: 'Slack' })]
    expect(rankRegistryEntries(entries, { query: 'SLACK', kind: 'all' }).map((e) => e.id)).toEqual(['slack'])
  })

  it('ranks verified entries first, then by star count, then alphabetically', () => {
    const entries = [
      entry({ id: 'low', verified: true, signals: { stars: 1 } }),
      entry({ id: 'high', verified: true, signals: { stars: 100 } }),
      entry({ id: 'unverified', verified: false, signals: { stars: 1000 } }),
    ]
    expect(rankRegistryEntries(entries, { query: '', kind: 'all' }).map((e) => e.id)).toEqual([
      'high',
      'low',
      'unverified',
    ])
  })
})

describe('isNewerVersion', () => {
  it('detects a newer patch, minor, and major version', () => {
    expect(isNewerVersion('0.1.0', '0.1.1')).toBe(true)
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(true)
    expect(isNewerVersion('0.1.0', '1.0.0')).toBe(true)
  })

  it('is false for an equal or older version', () => {
    expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false)
    expect(isNewerVersion('0.2.0', '0.1.9')).toBe(false)
  })
})

describe('latestVersion', () => {
  it('returns the highest semver version among an entry\'s versions', () => {
    const e = entry({ versions: [version({ version: '0.1.0' }), version({ version: '0.3.0' }), version({ version: '0.2.0' })] })
    expect(latestVersion(e).version).toBe('0.3.0')
  })
})
