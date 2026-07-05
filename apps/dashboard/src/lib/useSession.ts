'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, me, type Org, type OrgRole, type SessionInfo } from './api'

export interface SessionState {
  session: SessionInfo | null
  loading: boolean
  error: string | null
}

export function useSession(): SessionState {
  const router = useRouter()
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
          router.replace('/login')
          return
        }
        setState({ session: null, loading: false, error: 'Could not reach the Smokejumper server.' })
      })
    return () => {
      cancelled = true
    }
  }, [router])

  return state
}

export function canManageOrg(role: OrgRole | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export function canManageAnyOrg(orgs: Org[]): boolean {
  return orgs.some((org) => canManageOrg(org.role))
}
