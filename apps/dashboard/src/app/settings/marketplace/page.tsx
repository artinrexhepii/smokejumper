'use client'

import { useEffect, useState } from 'react'
import { getRegistry, type RegistryResponse } from '../../../lib/api'
import { useSession } from '../../../lib/useSession'
import { VerifiedBadge } from '../../../components/Badge'
import { formatAgo } from '../../../lib/format'
import { rankRegistryEntries, type KindFilter } from '../../../lib/registryRanking'

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
  const [listError, setListError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [view, setView] = useState<View>({ type: 'catalog' })

  useEffect(() => {
    let cancelled = false
    getRegistry()
      .then((response) => {
        if (cancelled) return
        setRegistry(response)
        setListError(null)
      })
      .catch(() => {
        if (!cancelled) setListError('Could not load the plugin marketplace.')
      })
    return () => {
      cancelled = true
    }
  }, [])

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
        <div className="settings-selects">
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
      {listError ? <p className="error-text">{listError}</p> : null}
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
            {selected.versions.map((v) => (
              <li key={v.version} className="version-row">
                <span>{v.version}</span>
                <span className="instance-name">sdk {v.sdkVersion}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="instance-list registry-list">
          {ranked.map((entry) => (
            <li key={entry.id} className="instance-row">
              <span className="badge">{entry.kind}</span>
              <span className="instance-name">
                {entry.name} {entry.verified ? <VerifiedBadge /> : null}
              </span>
              <span className="registry-signals">
                {entry.signals.stars !== undefined ? `★ ${entry.signals.stars}` : ''}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setView({ type: 'detail', entryId: entry.id })}
              >
                details
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
