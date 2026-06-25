import type { EvidenceRecord, Finding } from '../lib/api'
import { EvidenceItem } from './EvidenceItem'

export function FindingsList({
  findings,
  evidence,
}: {
  findings: Finding[]
  evidence: EvidenceRecord[]
}) {
  if (findings.length === 0) return <p className="empty">No findings yet.</p>
  return (
    <div className="findings">
      {findings.map((finding) => {
        const linked = evidence.filter((e) => finding.evidenceIds.includes(e.id))
        return (
          <div key={finding.id} className="finding">
            <span className="finding-specialist">{finding.specialist}</span>
            <p>{finding.summary}</p>
            {linked.length > 0 ? (
              <details>
                <summary>
                  {linked.length} evidence record{linked.length === 1 ? '' : 's'}
                </summary>
                {linked.map((e) => (
                  <EvidenceItem key={e.id} evidence={e} />
                ))}
              </details>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
