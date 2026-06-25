import type { EvidenceRecord } from '../lib/api'

export function EvidenceItem({ evidence }: { evidence: EvidenceRecord }) {
  return (
    <details className="evidence">
      <summary>
        <span className="evidence-seq">#{evidence.seq}</span>
        <span className="evidence-tool">{evidence.toolName}</span>
        <span className="evidence-summary">{evidence.summary}</span>
      </summary>
      <div className="evidence-body">
        <p className="evidence-label">input</p>
        <pre>{JSON.stringify(evidence.input, null, 2)}</pre>
        <p className="evidence-label">output</p>
        <pre>{JSON.stringify(evidence.output, null, 2)}</pre>
      </div>
    </details>
  )
}
