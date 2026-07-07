'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { listIncidents, listProjects, type Incident, type Project } from '../lib/api'
import { formatAgo } from '../lib/format'
import { canManageAnyOrg, useSession } from '../lib/useSession'
import { SeverityBadge, StatusBadge } from '../components/Badge'

interface FeedRow {
  incident: Incident
  project: Project
}

const POLL_MS = 10_000

function openHelp() {
  window.dispatchEvent(new Event('sj:help'))
}

export default function FeedPage() {
  const { session, loading, error } = useSession()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [rows, setRows] = useState<FeedRow[] | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)

  const orgs = session?.orgs ?? []
  const activeOrgId = orgId ?? orgs[0]?.id ?? null
  const canManage = session !== null && canManageAnyOrg(session.orgs)

  useEffect(() => {
    const org = activeOrgId
    if (!org) return
    let cancelled = false

    const load = async () => {
      try {
        const projects = await listProjects(org)
        const perProject = await Promise.all(
          projects.map(async (project) =>
            (await listIncidents(project.id)).map((incident) => ({ incident, project })),
          ),
        )
        if (cancelled) return
        const merged = perProject
          .flat()
          .sort((a, b) => b.incident.openedAt.localeCompare(a.incident.openedAt))
        setRows(merged)
        setFeedError(null)
      } catch {
        if (!cancelled) setFeedError('Could not load incidents.')
      }
    }

    void load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [activeOrgId])

  if (loading) return <p className="loading">Loading…</p>
  if (error) return <p className="error-text">{error}</p>
  if (!session) return null
  if (orgs.length === 0) return <p className="empty">You are not a member of any organization.</p>

  const list = rows ?? []
  const active = list.filter((r) => r.incident.status !== 'resolved').length
  const investigating = list.filter((r) => r.incident.status === 'investigating').length
  const resolved = list.filter((r) => r.incident.status === 'resolved').length

  return (
    <>
      <div className="board-hero" data-tour="board-hero">
        <div>
          <span className="board-hero-eyebrow">Incident command</span>
          <h1>Dispatch board</h1>
          <p>Every alert that fires opens an incident here — and an investigation starts on its own.</p>
        </div>
        {orgs.length > 1 ? (
          <select
            aria-label="Organization"
            value={activeOrgId ?? ''}
            onChange={(e) => {
              setOrgId(e.target.value)
              setRows(null)
            }}
          >
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {rows !== null && rows.length > 0 ? (
        <div className="board-stats" data-tour="board-stats">
          <div className="stat is-hot">
            <span className="stat-num">{active}</span>
            <span className="stat-label">Active</span>
          </div>
          <div className="stat">
            <span className="stat-num">{investigating}</span>
            <span className="stat-label">Investigating</span>
          </div>
          <div className="stat is-calm">
            <span className="stat-num">{resolved}</span>
            <span className="stat-label">Resolved</span>
          </div>
        </div>
      ) : null}

      {feedError ? <p className="error-text">{feedError}</p> : null}

      {rows === null ? (
        <p className="loading">Loading incidents…</p>
      ) : rows.length === 0 ? (
        <section className="empty-teach">
          <h2>Quiet skies.</h2>
          <p>
            No incidents yet — which is exactly how it should look until something breaks. Here&rsquo;s how Smokejumper
            fills this board on its own:
          </p>
          <ol className="teach-steps">
            <li className="teach-step">
              <span className="teach-step-num">01</span>
              <p className="teach-step-title">Connect a source</p>
              <p>Add telemetry (Datadog, Grafana, Kubernetes…) and an alert source so Smokejumper can see and be paged.</p>
            </li>
            <li className="teach-step">
              <span className="teach-step-num">02</span>
              <p className="teach-step-title">An alert opens an incident</p>
              <p>When the alert source fires, an incident lands here automatically — no one has to be watching.</p>
            </li>
            <li className="teach-step">
              <span className="teach-step-num">03</span>
              <p className="teach-step-title">Investigators report back</p>
              <p>AI specialists gather cited evidence and post a diagnosis you can confirm or reject.</p>
            </li>
          </ol>
          <div className="empty-actions">
            {canManage ? (
              <Link href="/settings/marketplace" className="btn btn-accent">
                Connect a source
              </Link>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={openHelp}>
              How it works
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="feed-head">
            <h2>All incidents</h2>
            <span className="text-dim mono" style={{ fontSize: '0.72rem' }}>
              live · refreshes every 10s
            </span>
          </div>
          <ol className="incident-list" data-tour="incident-list">
            {rows.map(({ incident, project }) => (
              <li key={incident.id}>
                <Link href={`/incidents/${incident.id}`} className={`incident-row sev-${incident.severity}`}>
                  <SeverityBadge severity={incident.severity} />
                  <StatusBadge status={incident.status} />
                  <span className="incident-title">{incident.title}</span>
                  <span className="mono text-dim">
                    {project.slug}/{incident.service}
                  </span>
                  <span className="text-dim">{incident.alertCount}×</span>
                  <span className="text-dim">{formatAgo(incident.lastAlertAt)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  )
}
