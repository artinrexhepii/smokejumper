import type { EvidenceRecord } from '../lib/api'
import type { TraceStep } from '../lib/trace'
import type { ConnectionState } from '../lib/useIncidentEvents'
import { EvidenceItem } from './EvidenceItem'

interface Props {
  steps: TraceStep[]
  connection: ConnectionState
  evidence: EvidenceRecord[]
  investigating: boolean
}

const connectionLabels: Record<ConnectionState, string> = {
  connecting: 'connecting…',
  live: 'live',
  reconnecting: 'reconnecting…',
}

export function TraceTimeline({ steps, connection, evidence, investigating }: Props) {
  return (
    <section className="card">
      <div className="section-head">
        <h2>Live investigation trace</h2>
        <span className={`conn conn-${connection}`}>
          <span className={`dot${connection === 'live' ? ' pulse' : ''}`} aria-hidden />
          {connectionLabels[connection]}
        </span>
      </div>
      {steps.length === 0 ? (
        <p className="empty">
          {investigating
            ? 'Waiting for live events…'
            : 'No live events — see the evidence log below for the recorded investigation.'}
        </p>
      ) : (
        <ol className="trace">
          {steps.map((step) => {
            const linked = evidence.filter((e) => step.evidenceIds.includes(e.id))
            return (
              <li key={step.key} className="trace-step">
                <div className="trace-step-head">
                  <span className="trace-step-time">
                    {new Date(step.occurredAt).toLocaleTimeString()}
                  </span>
                  <span className="trace-step-title">{step.title}</span>
                </div>
                {step.detail ? <p className="trace-step-detail">{step.detail}</p> : null}
                {linked.map((e) => (
                  <EvidenceItem key={e.id} evidence={e} />
                ))}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
