'use client'

import { useEffect, useState } from 'react'
import {
  ApiError,
  approveReview,
  generateReview,
  getReview,
  reviewExportUrl,
  updateReview,
  type IncidentReview,
  type ReviewBody,
} from '../lib/api'

interface Props {
  incidentId: string
  fetchReview?: typeof getReview
  generate?: typeof generateReview
  save?: typeof updateReview
  approve?: typeof approveReview
}

function linesToList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export function ReviewPanel({
  incidentId,
  fetchReview = getReview,
  generate = generateReview,
  save = updateReview,
  approve = approveReview,
}: Props) {
  const [review, setReview] = useState<IncidentReview | null>(null)
  const [draft, setDraft] = useState<ReviewBody | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchReview(incidentId)
      .then((found) => {
        if (cancelled) return
        setReview(found)
        setDraft(found.edited ?? found.generated)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setReview(null)
          setLoading(false)
          return
        }
        setError('Could not load the review.')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [incidentId, fetchReview])

  async function onGenerate() {
    setPending(true)
    setError(null)
    try {
      const generated = await generate(incidentId)
      setReview(generated)
      setDraft(generated.edited ?? generated.generated)
      setEditing(false)
    } catch {
      setError('Could not generate the review — try again.')
    } finally {
      setPending(false)
    }
  }

  async function onSave() {
    if (!draft) return
    setPending(true)
    setError(null)
    try {
      const updated = await save(incidentId, draft)
      setReview(updated)
      setDraft(updated.edited ?? updated.generated)
      setEditing(false)
    } catch {
      setError('Could not save the review — try again.')
    } finally {
      setPending(false)
    }
  }

  async function onApprove() {
    setPending(true)
    setError(null)
    try {
      const approved = await approve(incidentId)
      setReview(approved)
    } catch {
      setError('Could not approve the review — try again.')
    } finally {
      setPending(false)
    }
  }

  if (loading) return <p className="loading">Loading review…</p>

  return (
    <section className="card review-panel">
      <div className="section-head">
        <h2>Post-incident review</h2>
        {review ? <span className={`badge review-${review.status}`}>{review.status}</span> : null}
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {!review || !draft ? (
        <>
          <p className="empty">No review has been generated yet.</p>
          <button type="button" className="btn" onClick={onGenerate} disabled={pending}>
            Generate review
          </button>
        </>
      ) : editing ? (
        <div className="review-form">
          <label>
            Summary
            <textarea
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              rows={3}
            />
          </label>
          <label>
            Root cause
            <textarea
              value={draft.rootCause}
              onChange={(e) => setDraft({ ...draft, rootCause: e.target.value })}
              rows={2}
            />
          </label>
          <label>
            Contributing factors (one per line)
            <textarea
              value={draft.contributingFactors.join('\n')}
              onChange={(e) => setDraft({ ...draft, contributingFactors: linesToList(e.target.value) })}
              rows={3}
            />
          </label>
          <label>
            Action items (one per line)
            <textarea
              value={draft.actionItems.join('\n')}
              onChange={(e) => setDraft({ ...draft, actionItems: linesToList(e.target.value) })}
              rows={3}
            />
          </label>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onSave} disabled={pending}>
              Save
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="review-view">
          <p>{draft.summary}</p>
          <h3>Timeline</h3>
          <ul>
            {draft.timeline.map((entry, i) => (
              <li key={i}>
                <span className="mono">{entry.at}</span> — {entry.text}
              </li>
            ))}
          </ul>
          <h3>Root cause</h3>
          <p>{draft.rootCause}</p>
          <h3>Contributing factors</h3>
          <ul>
            {draft.contributingFactors.map((factor, i) => (
              <li key={i}>{factor}</li>
            ))}
          </ul>
          <h3>Action items</h3>
          <ul>
            {draft.actionItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setEditing(true)}
              disabled={review.status === 'approved'}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn"
              onClick={onApprove}
              disabled={pending || review.status === 'approved'}
            >
              {review.status === 'approved' ? 'Approved' : 'Approve'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onGenerate} disabled={pending}>
              Regenerate
            </button>
            <a className="btn btn-ghost" href={reviewExportUrl(incidentId)} download={`review-${incidentId}.md`}>
              Download markdown
            </a>
          </div>
        </div>
      )}
    </section>
  )
}
