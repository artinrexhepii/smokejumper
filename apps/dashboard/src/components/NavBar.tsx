'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { logout } from '../lib/api'
import { canManageAnyOrg, useSession } from '../lib/useSession'

export function NavBar() {
  const pathname = usePathname()
  const router = useRouter()
  const { session } = useSession()

  async function onLogout() {
    try {
      await logout()
    } catch {}
    router.push('/login')
  }

  const showSettings = pathname !== '/login' && session !== null && canManageAnyOrg(session.orgs)

  return (
    <header className="nav">
      <Link href="/" className="nav-brand">
        smokejumper
      </Link>
      {pathname === '/login' ? null : (
        <nav className="nav-links">
          {showSettings ? (
            <Link href="/settings/plugins" className="btn btn-ghost">
              settings
            </Link>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={onLogout}>
            log out
          </button>
        </nav>
      )}
    </header>
  )
}
