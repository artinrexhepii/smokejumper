'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ApiError, me, type Org, type OrgRole, type SessionInfo } from './api'

export interface SessionState {
  session: SessionInfo | null
  loading: boolean
  error: string | null
}

// Pages a signed-out visitor is allowed to land on. A 401 here means "not signed
// in yet" (e.g. accepting an invite), not "you got kicked out" — so we don't redirect.
function isPublicAuthPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/signup' || pathname.startsWith('/join')
}

export function useSession(): SessionState {
  const router = useRouter()
  const pathname = usePathname()
  const [state, setState] = useState<SessionState>({ session: null, loading: true, error: null })

  useEffect(() => {
    let cancelled = false
    me()
      .then((session) => {
        if (!cancelled) setState({ session, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) {
          if (!isPublicAuthPath(pathname)) router.replace('/login')
          setState({ session: null, loading: false, error: null })
          return
        }
        setState({ session: null, loading: false, error: 'Could not reach the Smokejumper server.' })
      })
    return () => {
      cancelled = true
    }
  }, [router, pathname])

  return state
}

export function canManageOrg(role: OrgRole | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export function canManageAnyOrg(orgs: Org[]): boolean {
  return orgs.some((org) => canManageOrg(org.role))
}
