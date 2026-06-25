'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { logout } from '../lib/api'

export function NavBar() {
  const pathname = usePathname()
  const router = useRouter()

  async function onLogout() {
    try {
      await logout()
    } catch {}
    router.push('/login')
  }

  return (
    <header className="nav">
      <Link href="/" className="nav-brand">
        smokejumper
      </Link>
      {pathname === '/login' ? null : (
        <button type="button" className="btn btn-ghost" onClick={onLogout}>
          log out
        </button>
      )}
    </header>
  )
}
