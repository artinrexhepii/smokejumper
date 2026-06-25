import type { IncidentStatus, Severity } from '../lib/api'

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge sev-${severity}`}>{severity}</span>
}

export function StatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <span className={`badge st-${status}`}>
      {status === 'investigating' ? <span className="dot pulse" aria-hidden /> : null}
      {status}
    </span>
  )
}
