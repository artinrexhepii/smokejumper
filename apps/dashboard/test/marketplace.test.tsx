// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>()
  return { ...actual, me: vi.fn(), getRegistry: vi.fn(), getRegistryPolicy: vi.fn(), installPlugin: vi.fn(), listPlugins: vi.fn() }
})

import {
  getRegistry,
  getRegistryPolicy,
  installPlugin,
  listPlugins,
  me,
  type PluginManifestInfo,
  type RegistryResponse,
} from '../src/lib/api'
import MarketplacePage from '../src/app/settings/marketplace/page'

const mockedMe = vi.mocked(me)
const mockedGetRegistry = vi.mocked(getRegistry)
const mockedListPlugins = vi.mocked(listPlugins)

beforeEach(() => {
  mockedListPlugins.mockResolvedValue([])
})

const ownerSession = {
  user: { id: 'u1', email: 'a@example.com', name: 'A' },
  orgs: [{ id: 'o1', name: 'Acme', slug: 'acme', role: 'owner' as const }],
}

const memberSession = {
  user: { id: 'u2', email: 'b@example.com', name: 'B' },
  orgs: [{ id: 'o1', name: 'Acme', slug: 'acme', role: 'member' as const }],
}

function registryFixture(): RegistryResponse {
  return {
    index: {
      generatedAt: '2026-07-06T00:00:00.000Z',
      signature: 'sig',
      signer: 'smokejumper-firstparty',
      entries: [
        {
          id: 'webhook',
          name: 'Generic Webhook',
          kind: 'alert-source',
          description: 'Ingests alerts from any system',
          repo: 'https://github.com/artinrexhepi/smokejumper',
          verified: true,
          signals: { stars: 42 },
          versions: [
            {
              version: '0.1.0',
              sdkVersion: '0.2.0',
              bundleUrl: 'https://example.com/webhook-0.1.0.tar.gz',
              digest: 'd'.repeat(64),
              signature: 's',
              signer: 'k',
            },
          ],
        },
        {
          id: 'slack',
          name: 'Slack',
          kind: 'notification-sink',
          description: 'Posts to Slack',
          repo: 'https://github.com/artinrexhepi/smokejumper',
          verified: true,
          signals: {},
          versions: [
            {
              version: '0.1.0',
              sdkVersion: '0.2.0',
              bundleUrl: 'https://example.com/slack-0.1.0.tar.gz',
              digest: 'f'.repeat(64),
              signature: 's',
              signer: 'k',
            },
          ],
        },
      ],
    },
    installed: [],
  }
}

function upgradeFixture(): RegistryResponse {
  const base = registryFixture()
  base.index.entries[0]!.versions.push({
    version: '0.2.0',
    sdkVersion: '0.2.0',
    bundleUrl: 'https://example.com/webhook-0.2.0.tar.gz',
    digest: 'e'.repeat(64),
    signature: 's',
    signer: 'k',
  })
  base.installed = [{ id: 'webhook', version: '0.1.0' }]
  return base
}

const mockedGetPolicy = vi.mocked(getRegistryPolicy)
const mockedInstall = vi.mocked(installPlugin)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MarketplacePage', () => {
  it('renders the catalog with verified badges and signals', async () => {
    mockedMe.mockResolvedValue(ownerSession)
    mockedGetRegistry.mockResolvedValue(registryFixture())
    render(<MarketplacePage />)
    await waitFor(() => expect(screen.getByText('Generic Webhook')).toBeTruthy())
    expect(screen.getByText('Slack')).toBeTruthy()
    expect(screen.getAllByText('verified')).toHaveLength(2)
    expect(screen.getByText('★ 42')).toBeTruthy()
  })

  it('filters the catalog by search query', async () => {
    mockedMe.mockResolvedValue(ownerSession)
    mockedGetRegistry.mockResolvedValue(registryFixture())
    render(<MarketplacePage />)
    await waitFor(() => expect(screen.getByText('Generic Webhook')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Search plugins'), { target: { value: 'slack' } })
    await waitFor(() => expect(screen.queryByText('Generic Webhook')).toBeNull())
    expect(screen.getByText('Slack')).toBeTruthy()
  })

  it('filters the catalog by kind', async () => {
    mockedMe.mockResolvedValue(ownerSession)
    mockedGetRegistry.mockResolvedValue(registryFixture())
    render(<MarketplacePage />)
    await waitFor(() => expect(screen.getByText('Generic Webhook')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Filter by kind'), { target: { value: 'notification-sink' } })
    await waitFor(() => expect(screen.queryByText('Generic Webhook')).toBeNull())
    expect(screen.getByText('Slack')).toBeTruthy()
  })

  it('opens a detail view with the version list', async () => {
    mockedMe.mockResolvedValue(ownerSession)
    mockedGetRegistry.mockResolvedValue(registryFixture())
    render(<MarketplacePage />)
    await waitFor(() => expect(screen.getByText('Generic Webhook')).toBeTruthy())
    fireEvent.click(screen.getAllByText('details')[0]!)
    await waitFor(() => expect(screen.getByText('0.1.0')).toBeTruthy())
    expect(screen.getByText(/Ingests alerts from any system/)).toBeTruthy()
  })

  it('reflects the auto-update policy read-only', async () => {
    mockedMe.mockResolvedValue(ownerSession)
    mockedGetRegistry.mockResolvedValue(registryFixture())
    mockedGetPolicy.mockResolvedValue({ autoUpdate: true })
    render(<MarketplacePage />)
    await waitFor(() => expect(screen.getByText(/Auto-update: on/)).toBeTruthy())
  })

  it('shows an upgrade affordance when a newer version exists for an installed plugin', async () => {
    mockedMe.mockResolvedValue(ownerSession)
    mockedGetRegistry.mockResolvedValue(upgradeFixture())
    mockedGetPolicy.mockResolvedValue({ autoUpdate: false })
    render(<MarketplacePage />)
    await waitFor(() => expect(screen.getByText('upgrade available')).toBeTruthy())
  })

  it('installs a version from the detail view and shows the restart-required message', async () => {
    mockedMe.mockResolvedValue(ownerSession)
    mockedGetRegistry.mockResolvedValue(upgradeFixture())
    mockedGetPolicy.mockResolvedValue({ autoUpdate: false })
    mockedInstall.mockResolvedValue({ restartRequired: true })
    render(<MarketplacePage />)
    await waitFor(() => expect(screen.getByText('Generic Webhook')).toBeTruthy())
    fireEvent.click(screen.getAllByText('details')[0]!)
    await waitFor(() => expect(screen.getByText('0.2.0')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'install' }))
    await waitFor(() => expect(mockedInstall).toHaveBeenCalledWith('webhook', '0.2.0'))
    await waitFor(() => expect(screen.getByText(/queued for install/)).toBeTruthy())
  })

  it('disables and relabels the install button for an already-installed version', async () => {
    mockedMe.mockResolvedValue(ownerSession)
    mockedGetRegistry.mockResolvedValue(upgradeFixture())
    mockedGetPolicy.mockResolvedValue({ autoUpdate: false })
    render(<MarketplacePage />)
    await waitFor(() => expect(screen.getByText('Generic Webhook')).toBeTruthy())
    fireEvent.click(screen.getAllByText('details')[0]!)
    await waitFor(() => expect(screen.getByText('0.2.0')).toBeTruthy())
    const installedButton = screen.getByRole('button', { name: 'installed' }) as HTMLButtonElement
    expect(installedButton.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'install' })).toBeTruthy()
  })

  it('hides install controls for a member who cannot manage any org', async () => {
    mockedMe.mockResolvedValue(memberSession)
    mockedGetRegistry.mockResolvedValue(registryFixture())
    mockedGetPolicy.mockResolvedValue({ autoUpdate: false })
    render(<MarketplacePage />)
    await waitFor(() => expect(screen.getByText('Generic Webhook')).toBeTruthy())
    fireEvent.click(screen.getAllByText('details')[0]!)
    await waitFor(() => expect(screen.getByText('0.1.0')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'install' })).toBeNull()
  })

  it('marks built-in plugins and does not offer to install them', async () => {
    mockedMe.mockResolvedValue(ownerSession)
    mockedGetRegistry.mockResolvedValue(registryFixture())
    mockedGetPolicy.mockResolvedValue({ autoUpdate: false })
    mockedListPlugins.mockResolvedValue([
      {
        manifest: {
          id: 'webhook',
          name: 'Generic Webhook',
          version: '0.1.0',
          kind: 'alert-source',
          description: 'Ingests alerts',
          sdkVersion: '0.2.0',
        },
        descriptor: { config: [], credentials: [] },
      },
    ] satisfies PluginManifestInfo[])
    render(<MarketplacePage />)
    await waitFor(() => expect(screen.getByText('Generic Webhook')).toBeTruthy())
    expect(screen.getByText('built-in')).toBeTruthy()
    fireEvent.click(screen.getAllByText('details')[0]!)
    await waitFor(() => expect(screen.getByText('0.1.0')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'install' })).toBeNull()
  })
})
