import type { Diagnosis, EvidenceRecord } from '../lib/api'
import { formatConfidence } from '../lib/format'
import { EvidenceItem } from './EvidenceItem'
import { VerdictControls } from './VerdictControls'

export function DiagnosisCard({
  diagnosis,
  evidence,
}: {
  diagnosis: Diagnosis
  evidence: EvidenceRecord[]
}) {
  return (
    <section className="card diagnosis">
      <div className="section-head">
        <h2>Diagnosis</h2>
        <span className="confidence">confidence {formatConfidence(diagnosis.confidence)}</span>
      </div>
      <p className="root-cause">{diagnosis.rootCause}</p>
      <h3>Evidence chain</h3>
      <ol className="claims">
        {diagnosis.evidenceChain.map((claim, i) => {
          const linked = evidence.filter((e) => claim.evidenceIds.includes(e.id))
          return (
            <li key={i} className="claim">
              <span className={`badge ${claim.verified ? 'claim-verified' : 'claim-hypothesis'}`}>
                {claim.verified ? 'verified' : 'hypothesis'}
              </span>
              <span>{claim.claim}</span>
              {linked.map((e) => (
                <EvidenceItem key={e.id} evidence={e} />
              ))}
            </li>
          )
        })}
      </ol>
      <h3>Suggested remediation</h3>
      <p className="remediation">{diagnosis.remediation}</p>
      {diagnosis.openQuestions.length > 0 ? (
        <>
          <h3>Open questions</h3>
          <ul>
            {diagnosis.openQuestions.map((question, i) => (
              <li key={i}>{question}</li>
            ))}
          </ul>
        </>
      ) : null}
      <h3>Human verdict</h3>
      <VerdictControls
        diagnosisId={diagnosis.id}
        verdict={diagnosis.humanVerdict}
        note={diagnosis.humanNote}
      />
    </section>
  )
}
