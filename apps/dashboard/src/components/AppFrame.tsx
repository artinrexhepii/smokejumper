'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { logout } from '../lib/api'
import { canManageAnyOrg, useSession } from '../lib/useSession'
import { HowItWorks } from './HowItWorks'

const ONBOARDED_KEY = 'sj_onboarded_v1'

function Icon({ path, filled = false }: { path: ReactNode; filled?: boolean }) {
  return (
    <svg
      className="rail-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

const icons = {
  flame: <path d="M12 3c.5 3 3 4 3 7a3 3 0 1 1-6 0c0-1 .5-1.7 1-2.3C9 9 8 10.5 8 13a4 4 0 1 0 8 0c0-4-2.5-6-4-10Z" />,
  plug: (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" />
      <path d="M12 17v4" />
    </>
  ),
  book: (
    <>
      <path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" />
      <path d="M17 4h2v13M8 8h6M8 12h6" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  folder: <path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.6 19a5.5 5.5 0 0 0-3-4.9" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.3a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 3.7" />
      <path d="M12 17.2h.01" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 12H3m0 0 3-3m-3 3 3 3" />
    </>
  ),
}

const sectionTitles: Array<[RegExp, string]> = [
  [/^\/incidents/, 'Active incident'],
  [/^\/settings\/projects/, 'Projects'],
  [/^\/settings\/team/, 'Team'],
  [/^\/settings\/plugins/, 'Telemetry & alert sources'],
  [/^\/settings\/runbooks/, 'Runbooks'],
  [/^\/settings\/marketplace/, 'Plugin marketplace'],
  [/^\/$/, 'Dispatch'],
]

function sectionTitle(pathname: string): string {
  for (const [re, title] of sectionTitles) if (re.test(pathname)) return title
  return 'Smokejumper'
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { session } = useSession()
  const [helpOpen, setHelpOpen] = useState(false)

  const isAuthPage = pathname === '/login' || pathname === '/signup' || pathname.startsWith('/join')
  const canManage = session !== null && canManageAnyOrg(session.orgs)

  // First-run: open the guided tour once, after the user is signed in.
  useEffect(() => {
    if (isAuthPage || session === null) return
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(ONBOARDED_KEY)) return
    setHelpOpen(true)
  }, [isAuthPage, session])

  // Any page can open the tour by dispatching a `sj:help` event.
  useEffect(() => {
    const open = () => setHelpOpen(true)
    window.addEventListener('sj:help', open)
    return () => window.removeEventListener('sj:help', open)
  }, [])

  function dismissHelp() {
    setHelpOpen(false)
    try {
      window.localStorage.setItem(ONBOARDED_KEY, '1')
    } catch {}
  }

  async function onLogout() {
    try {
      await logout()
    } catch {}
    router.push('/login')
  }

  if (isAuthPage) {
    return <main className="login-shell">{children}</main>
  }

  const navActive = (href: string) =>
    href === '/' ? pathname === '/' || pathname.startsWith('/incidents') : pathname.startsWith(href)

  const wordmark = (
    <Link href="/" className="brand" aria-label="Smokejumper — dispatch board">
      <span className="brand-mark" aria-hidden="true">
        <span className="brand-spark" />
      </span>
      <span className="brand-word">Smokejumper</span>
    </Link>
  )

  return (
    <div className="app-shell">
      <aside className="rail">
        {wordmark}

        <nav className="rail-nav" aria-label="Primary">
          <span className="rail-section">Operations</span>
          <Link href="/" className={`rail-link${navActive('/') ? ' is-active' : ''}`}>
            <Icon path={icons.flame} filled={navActive('/')} />
            Dispatch
          </Link>

          {canManage ? (
            <>
              <span className="rail-section">Configure</span>
              <Link
                href="/settings/projects"
                className={`rail-link${navActive('/settings/projects') ? ' is-active' : ''}`}
              >
                <Icon path={icons.folder} />
                Projects
              </Link>
              <Link
                href="/settings/team"
                className={`rail-link${navActive('/settings/team') ? ' is-active' : ''}`}
              >
                <Icon path={icons.users} />
                Team
              </Link>
              <Link
                href="/settings/plugins"
                className={`rail-link${navActive('/settings/plugins') ? ' is-active' : ''}`}
              >
                <Icon path={icons.plug} />
                Sources
              </Link>
              <Link
                href="/settings/marketplace"
                className={`rail-link${navActive('/settings/marketplace') ? ' is-active' : ''}`}
              >
                <Icon path={icons.grid} />
                Marketplace
              </Link>
              <Link
                href="/settings/runbooks"
                className={`rail-link${navActive('/settings/runbooks') ? ' is-active' : ''}`}
              >
                <Icon path={icons.book} />
                Runbooks
              </Link>
            </>
          ) : null}
        </nav>

        <div className="rail-foot">
          <button type="button" className="rail-link rail-help" onClick={() => setHelpOpen(true)}>
            <Icon path={icons.help} />
            How it works
          </button>
          {session ? (
            <div className="rail-user">
              <span className="rail-avatar" aria-hidden="true">
                {(session.user.name ?? session.user.email).slice(0, 1).toUpperCase()}
              </span>
              <span className="rail-user-mail" title={session.user.email}>
                {session.user.email}
              </span>
              <button type="button" className="rail-logout" onClick={onLogout} aria-label="Log out">
                <Icon path={icons.logout} />
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-eyebrow">Incident command</span>
            <h2 className="topbar-section">{sectionTitle(pathname)}</h2>
          </div>
          <button type="button" className="btn btn-ghost topbar-help" onClick={() => setHelpOpen(true)}>
            <Icon path={icons.help} />
            Guide
          </button>
        </header>
        <div className="workspace">{children}</div>
      </div>

      <HowItWorks open={helpOpen} onClose={dismissHelp} canManage={canManage} />
    </div>
  )
}
