'use client'

import { useEffect, useRef, useState } from 'react'
import {
  getRegistry,
  getRegistryPolicy,
  installPlugin,
  listPlugins,
  type RegistryEntryView,
  type RegistryPolicy,
  type RegistryResponse,
} from '../../../lib/api'
import { canManageAnyOrg, useSession } from '../../../lib/useSession'
import { VerifiedBadge } from '../../../components/Badge'
import { formatAgo } from '../../../lib/format'
import { isNewerVersion, latestVersion, rankRegistryEntries, type KindFilter } from '../../../lib/registryRanking'

type View = { type: 'catalog' } | { type: 'detail'; entryId: string }

const KIND_OPTIONS: Array<{ value: KindFilter; label: string }> = [
  { value: 'all', label: 'All kinds' },
  { value: 'alert-source', label: 'Alert source' },
  { value: 'telemetry-source', label: 'Telemetry source' },
  { value: 'context-source', label: 'Context source' },
  { value: 'notification-sink', label: 'Notification sink' },
  { value: 'action-sink', label: 'Action sink' },
]

export default function MarketplacePage() {
  const { session, loading, error } = useSession()
  const [registry, setRegistry] = useState<RegistryResponse | null>(null)
  const [policy, setPolicy] = useState<RegistryPolicy | null>(null)
  const [builtinIds, setBuiltinIds] = useState<Set<string>>(new Set())
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [view, setView] = useState<View>({ type: 'catalog' })
  const [installingKey, setInstallingKey] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => () => { mounted.current = false }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([getRegistry(), getRegistryPolicy(), listPlugins().catch(() => [])])
      .then(([registryResponse, policyResponse, plugins]) => {
        if (cancelled) return
        setRegistry(registryResponse)
        setPolicy(policyResponse)
        setBuiltinIds(new Set(plugins.map((p) => p.manifest.id)))
        setListError(null)
      })
      .catch(() => {
        if (!cancelled) setListError('Could not load the plugin marketplace.')
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const canManage = session !== null && canManageAnyOrg(session.orgs)
  const installedById = new Map((registry?.installed ?? []).map((i) => [i.id, i.version]))

  async function onInstall(entry: RegistryEntryView, version: string) {
    const key = `${entry.id}@${version}`
    setInstallingKey(key)
    setInstallMessage(null)
    try {
      const { restartRequired } = await installPlugin(entry.id, version)
      if (!mounted.current) return
      if (restartRequired) {
        setInstallMessage(`${entry.name} ${version} queued for install — restart the server to apply.`)
      }
      setReloadToken((t) => t + 1)
    } catch {
      if (mounted.current) setListError('Could not install the plugin — try again.')
    } finally {
      if (mounted.current) setInstallingKey(null)
    }
  }

  if (loading) return <p className="loading">Loading…</p>
  if (error) return <p className="error-text">{error}</p>
  if (!session) return null
  if (registry === null) {
    return listError ? <p className="error-text">{listError}</p> : <p className="loading">Loading marketplace…</p>
  }

  const ranked = rankRegistryEntries(registry.index.entries, { query, kind: kindFilter })
  const selected = view.type === 'detail' ? registry.index.entries.find((e) => e.id === view.entryId) : null

  return (
    <>
      <div className="feed-head">
        <h1>Plugin marketplace</h1>
        <div className="settings-selects" data-tour="market-search">
          <input
            type="search"
            aria-label="Search plugins"
            placeholder="Search plugins…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Filter by kind"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as KindFilter)}
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="policy-note" data-tour="market-policy">
        Auto-update: {policy?.autoUpdate ? 'on' : 'off (default)'} — installed plugins run in-process with the
        server&rsquo;s privileges; only install plugins you trust.
      </p>
      {listError ? <p className="error-text">{listError}</p> : null}
      {installMessage ? <p className="install-note">{installMessage}</p> : null}
      {view.type === 'detail' && selected ? (
        <div className="card registry-detail">
          <button type="button" className="btn btn-ghost" onClick={() => setView({ type: 'catalog' })}>
            ← back to catalog
          </button>
          <h2>
            {selected.name} {selected.verified ? <VerifiedBadge /> : null}
          </h2>
          <p>{selected.description}</p>
          <p>
            <a href={selected.repo} target="_blank" rel="noreferrer">
              {selected.repo}
            </a>
          </p>
          <p className="registry-signals">
            {selected.signals.stars !== undefined ? <span>★ {selected.signals.stars}</span> : null}
            {selected.signals.downloads !== undefined ? (
              <span>{selected.signals.downloads} downloads/mo</span>
            ) : null}
            {selected.signals.lastReleaseAt ? (
              <span>released {formatAgo(selected.signals.lastReleaseAt)}</span>
            ) : null}
          </p>
          <ul className="version-list">
            {selected.versions.map((v) => {
              const installedVersion = installedById.get(selected.id)
              const isInstalled = installedVersion === v.version
              const key = `${selected.id}@${v.version}`
              return (
                <li key={v.version} className="version-row">
                  <span>{v.version}</span>
                  <span className="instance-name">sdk {v.sdkVersion}</span>
                  {builtinIds.has(selected.id) ? (
                    <span className="instance-name">built-in</span>
                  ) : canManage ? (
                    <button
                      type="button"
                      className={`btn${isInstalled ? ' btn-active' : ''}`}
                      disabled={isInstalled || installingKey === key}
                      onClick={() => onInstall(selected, v.version)}
                    >
                      {isInstalled ? 'installed' : installingKey === key ? 'installing…' : 'install'}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <ul className="instance-list registry-list" data-tour="market-list">
          {ranked.map((entry) => {
            const installedVersion = installedById.get(entry.id)
            const latest = latestVersion(entry)
            const hasUpgrade = installedVersion !== undefined && isNewerVersion(installedVersion, latest.version)
            return (
              <li key={entry.id} className="instance-row">
                <span className="badge">{entry.kind}</span>
                <span className="instance-name">
                  {entry.name} {entry.verified ? <VerifiedBadge /> : null}
                </span>
                <span className="registry-signals">
                  {entry.signals.stars !== undefined ? `★ ${entry.signals.stars}` : ''}
                </span>
                {installedVersion ? <span className="badge">installed {installedVersion}</span> : null}
                {hasUpgrade ? <span className="badge health-checking">upgrade available</span> : null}
                {builtinIds.has(entry.id) ? <span className="badge">built-in</span> : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setView({ type: 'detail', entryId: entry.id })}
                >
                  details
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
