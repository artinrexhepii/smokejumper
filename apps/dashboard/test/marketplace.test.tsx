// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>()
  return { ...actual, me: vi.fn(), getRegistry: vi.fn() }
})

import { getRegistry, me, type RegistryResponse } from '../src/lib/api'
import MarketplacePage from '../src/app/settings/marketplace/page'

const mockedMe = vi.mocked(me)
const mockedGetRegistry = vi.mocked(getRegistry)

const ownerSession = {
  user: { id: 'u1', email: 'a@example.com', name: 'A' },
  orgs: [{ id: 'o1', name: 'Acme', slug: 'acme', role: 'owner' as const }],
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
})
