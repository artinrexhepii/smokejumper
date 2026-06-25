'use client'

import { useState } from 'react'
import { submitVerdict, type Verdict } from '../lib/api'

const options: Array<{ verdict: Verdict; label: string }> = [
  { verdict: 'confirmed', label: 'Confirm' },
  { verdict: 'partial', label: 'Partially right' },
  { verdict: 'rejected', label: 'Reject' },
]

interface Props {
  diagnosisId: string
  verdict: Verdict | null
  note: string | null
  submit?: (diagnosisId: string, verdict: Verdict, note?: string) => Promise<void>
}

export function VerdictControls({ diagnosisId, verdict, note, submit = submitVerdict }: Props) {
  const [current, setCurrent] = useState<Verdict | null>(verdict)
  const [draft, setDraft] = useState(note ?? '')
  const [error, setError] = useState<string | null>(null)

  async function choose(next: Verdict) {
    const previous = current
    setCurrent(next)
    setError(null)
    try {
      await submit(diagnosisId, next, draft.trim() === '' ? undefined : draft.trim())
    } catch {
      setCurrent(previous)
      setError('Could not save verdict — try again.')
    }
  }

  return (
    <div className="verdict">
      <div className="verdict-row">
        {options.map((option) => (
          <button
            key={option.verdict}
            type="button"
            className={`btn${current === option.verdict ? ' btn-active' : ''}`}
            onClick={() => choose(option.verdict)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="verdict-note">
        Note (optional)
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} />
      </label>
      {current ? <p className="verdict-current">Verdict: {current}</p> : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
