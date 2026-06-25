'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { listIncidents, listProjects, type Incident, type Project } from '../lib/api'
import { formatAgo } from '../lib/format'
import { useSession } from '../lib/useSession'
import { SeverityBadge, StatusBadge } from '../components/Badge'

interface FeedRow {
  incident: Incident
  project: Project
}

const POLL_MS = 10_000

export default function FeedPage() {
  const { session, loading, error } = useSession()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [rows, setRows] = useState<FeedRow[] | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)

  const orgs = session?.orgs ?? []
  const activeOrgId = orgId ?? orgs[0]?.id ?? null

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

  return (
    <>
      <div className="feed-head">
        <h1>Incidents</h1>
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
      </div>
      {feedError ? <p className="error-text">{feedError}</p> : null}
      {rows === null ? (
        <p className="loading">Loading incidents…</p>
      ) : rows.length === 0 ? (
        <p className="empty">No incidents. Quiet skies.</p>
      ) : (
        <ol className="incident-list">
          {rows.map(({ incident, project }) => (
            <li key={incident.id}>
              <Link href={`/incidents/${incident.id}`} className="incident-row">
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
      )}
    </>
  )
}
