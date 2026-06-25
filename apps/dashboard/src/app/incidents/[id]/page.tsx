'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { getIncident, type IncidentDetail } from '../../../lib/api'
import { formatAgo } from '../../../lib/format'
import { useIncidentEvents } from '../../../lib/useIncidentEvents'
import { useSession } from '../../../lib/useSession'
import { SeverityBadge, StatusBadge } from '../../../components/Badge'
import { DiagnosisCard } from '../../../components/DiagnosisCard'
import { EvidenceItem } from '../../../components/EvidenceItem'
import { FindingsList } from '../../../components/FindingsList'
import { TraceTimeline } from '../../../components/TraceTimeline'

export default function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { session, loading: sessionLoading, error: sessionError } = useSession()
  const [detail, setDetail] = useState<IncidentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(() => {
    getIncident(id)
      .then(setDetail)
      .catch(() => setError('Could not load the incident.'))
  }, [id])

  useEffect(() => {
    refetch()
  }, [refetch])

  const { steps, connection } = useIncidentEvents(id, refetch)

  if (sessionLoading || !session) return <p className="loading">Loading…</p>
  if (sessionError) return <p className="error-text">{sessionError}</p>
  if (error) return <p className="error-text">{error}</p>
  if (!detail) return <p className="loading">Loading incident…</p>

  const { incident, investigation, findings, diagnosis, evidence } = detail

  return (
    <>
      <header className="incident-head">
        <div className="incident-head-badges">
          <SeverityBadge severity={incident.severity} />
          <StatusBadge status={incident.status} />
        </div>
        <h1>{incident.title}</h1>
        <p className="incident-meta">
          <span className="mono">{incident.service}</span>
          <span>
            {incident.alertCount} alert{incident.alertCount === 1 ? '' : 's'}
          </span>
          <span>opened {formatAgo(incident.openedAt)}</span>
        </p>
        {investigation?.status === 'budget_exceeded' ? (
          <p className="warn-text">
            Investigation stopped early — budget exceeded. Findings may be partial.
          </p>
        ) : null}
      </header>
      <TraceTimeline
        steps={steps}
        connection={connection}
        evidence={evidence}
        investigating={incident.status === 'open' || incident.status === 'investigating'}
      />
      <section className="card">
        <h2>Findings</h2>
        <FindingsList findings={findings} evidence={evidence} />
      </section>
      {diagnosis ? (
        <DiagnosisCard diagnosis={diagnosis} evidence={evidence} />
      ) : (
        <section className="card">
          <h2>Diagnosis</h2>
          <p className="empty">No diagnosis yet — the investigation is still running.</p>
        </section>
      )}
      <section className="card">
        <h2>Evidence log</h2>
        {evidence.length === 0 ? (
          <p className="empty">No evidence recorded yet.</p>
        ) : (
          evidence.map((e) => <EvidenceItem key={e.id} evidence={e} />)
        )}
      </section>
    </>
  )
}
