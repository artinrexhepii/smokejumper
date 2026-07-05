// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>()
  return { ...actual, me: vi.fn() }
})

import { ApiError, me, type Org } from '../src/lib/api'
import { canManageAnyOrg, canManageOrg, useSession } from '../src/lib/useSession'

const mockedMe = vi.mocked(me)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useSession', () => {
  it('exposes the session once /api/me resolves', async () => {
    const session = {
      user: { id: 'u1', email: 'a@example.com', name: 'A' },
      orgs: [{ id: 'o1', name: 'Acme', slug: 'acme', role: 'owner' as const }],
    }
    mockedMe.mockResolvedValue(session)
    const { result } = renderHook(() => useSession())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.session).toEqual(session)
    expect(result.current.error).toBeNull()
  })

  it('redirects to /login on 401', async () => {
    mockedMe.mockRejectedValue(new ApiError(401, 'unauthorized'))
    renderHook(() => useSession())
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
  })

  it('surfaces non-auth failures as an error without redirecting', async () => {
    mockedMe.mockRejectedValue(new TypeError('fetch failed'))
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.loading).toBe(false)
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('canManageOrg', () => {
  it('allows owner and admin, denies member and undefined', () => {
    expect(canManageOrg('owner')).toBe(true)
    expect(canManageOrg('admin')).toBe(true)
    expect(canManageOrg('member')).toBe(false)
    expect(canManageOrg(undefined)).toBe(false)
  })
})

describe('canManageAnyOrg', () => {
  const org = (role: Org['role']): Org => ({ id: 'o', name: 'Acme', slug: 'acme', role })

  it('is true when at least one org is owner or admin', () => {
    expect(canManageAnyOrg([org('member'), org('admin')])).toBe(true)
  })

  it('is false when every org is a member', () => {
    expect(canManageAnyOrg([org('member')])).toBe(false)
  })

  it('is false for an empty org list', () => {
    expect(canManageAnyOrg([])).toBe(false)
  })
})
