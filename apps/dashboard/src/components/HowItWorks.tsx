'use client'

import Link from 'next/link'
import { useEffect } from 'react'

interface Step {
  title: string
  body: string
  glyph: React.ReactNode
}

const steps: Step[] = [
  {
    title: 'Connect your telemetry',
    body: 'Add the sources Smokejumper can see through — Datadog, Grafana, Kubernetes, Elasticsearch, logs. These are read-only; nothing is ever changed in your systems.',
    glyph: (
      <>
        <path d="M9 3v5M15 3v5" />
        <path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" />
        <path d="M12 17v4" />
      </>
    ),
  },
  {
    title: 'Alerts open incidents',
    body: 'Wire an alert source — PagerDuty, a webhook, anything. When it fires, Smokejumper opens an incident automatically. No one has to be watching.',
    glyph: <path d="M12 3c.5 3 3 4 3 7a3 3 0 1 1-6 0c0-1 .5-1.7 1-2.3C9 9 8 10.5 8 13a4 4 0 1 0 8 0c0-4-2.5-6-4-10Z" />,
  },
  {
    title: 'Investigators are dispatched',
    body: 'A triage officer, a planner, and specialist agents parachute in — they run your read-only tools, correlate deploys, and collect evidence. Every claim is cited to the telemetry it came from.',
    glyph: (
      <>
        <path d="M4 11a8 8 0 0 1 16 0" />
        <path d="M4 11c0 2 1.6 3 3.2 3L12 11l4.8 3c1.6 0 3.2-1 3.2-3" />
        <path d="M12 11v6m0 0-2.2 3h4.4L12 17Z" />
      </>
    ),
  },
  {
    title: 'You confirm the verdict',
    body: 'Read the evidence-backed diagnosis and mark it right or wrong. Your verdict, your runbooks, and past post-incident reviews sharpen every dispatch that follows.',
    glyph: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12.5 2.5 2.5 4.5-5" />
      </>
    ),
  },
]

export function HowItWorks({
  open,
  onClose,
  canManage,
}: {
  open: boolean
  onClose: () => void
  canManage: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="tour-backdrop" role="dialog" aria-modal="true" aria-labelledby="tour-title" onClick={onClose}>
      <div className="tour" onClick={(e) => e.stopPropagation()}>
        <div className="tour-head">
          <span className="tour-eyebrow">Welcome to the command console</span>
          <h1 id="tour-title" className="tour-title">
            How Smokejumper works
          </h1>
          <p className="tour-lede">
            It watches your systems, and when something breaks it dispatches AI investigators that come back with a
            cited diagnosis — so you start from evidence, not a blank page.
          </p>
          <button type="button" className="tour-close" onClick={onClose} aria-label="Close guide">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <ol className="tour-steps">
          {steps.map((step, i) => (
            <li key={step.title} className="tour-step">
              <span className="tour-step-rail" aria-hidden="true">
                <span className="tour-step-num">{i + 1}</span>
              </span>
              <div className="tour-step-body">
                <div className="tour-step-title">
                  <svg
                    className="tour-step-glyph"
                    viewBox="0 0 24 24"
                    width="17"
                    height="17"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {step.glyph}
                  </svg>
                  {step.title}
                </div>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="tour-foot">
          {canManage ? (
            <Link href="/settings/marketplace" className="btn btn-accent" onClick={onClose}>
              Connect a source
            </Link>
          ) : null}
          <button type="button" className={canManage ? 'btn btn-ghost' : 'btn btn-accent'} onClick={onClose}>
            {canManage ? 'Explore the board' : 'Got it'}
          </button>
          <span className="tour-foot-note">Reopen anytime from “How it works”.</span>
        </div>
      </div>
    </div>
  )
}
