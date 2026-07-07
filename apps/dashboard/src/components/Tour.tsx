'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TourDef, TourPlacement, TourStep } from '../lib/tours'

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const POP_W = 340
const POP_H_EST = 210
const GAP = 14
const PAD = 16
const RING = 6

function findTarget(step: TourStep | undefined): HTMLElement | null {
  if (!step?.target) return null
  return document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
}

function stepPresent(step: TourStep): boolean {
  return !step.target || findTarget(step) !== null
}

function rectOf(el: HTMLElement): Rect | null {
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function popStyle(rect: Rect | null, placement: TourPlacement = 'bottom'): React.CSSProperties {
  if (!rect || typeof window === 'undefined') return {}
  const vw = window.innerWidth
  const vh = window.innerHeight
  let place = placement

  if (place === 'bottom' && rect.top + rect.height + GAP + POP_H_EST > vh) place = 'top'
  if (place === 'top' && rect.top - GAP - POP_H_EST < 0) place = 'bottom'
  if (place === 'right' && rect.left + rect.width + GAP + POP_W > vw) place = 'left'
  if (place === 'left' && rect.left - GAP - POP_W < 0) place = 'right'

  let top: number
  let left: number
  if (place === 'bottom') {
    top = rect.top + rect.height + GAP
    left = rect.left
  } else if (place === 'top') {
    top = rect.top - POP_H_EST - GAP
    left = rect.left
  } else if (place === 'right') {
    top = rect.top
    left = rect.left + rect.width + GAP
  } else {
    top = rect.top
    left = rect.left - POP_W - GAP
  }

  left = Math.max(PAD, Math.min(left, vw - POP_W - PAD))
  top = Math.max(PAD, Math.min(top, vh - POP_H_EST - PAD))
  return { top, left, width: POP_W }
}

export function Tour({ tour, onClose }: { tour: TourDef | null; onClose: (completed: boolean) => void }) {
  const [mounted, setMounted] = useState(false)
  const [steps, setSteps] = useState<TourStep[]>([])
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)

  useEffect(() => setMounted(true), [])

  // When a tour opens, snapshot the steps whose targets are actually on the page.
  useEffect(() => {
    if (!tour) {
      setSteps([])
      setIndex(0)
      return
    }
    const timer = setTimeout(() => {
      const present = tour.steps.filter(stepPresent)
      setSteps(present)
      setIndex(0)
      if (present.length === 0) onClose(true)
    }, 120)
    return () => clearTimeout(timer)
  }, [tour, onClose])

  const step = steps[index]

  const measure = useCallback(() => {
    const el = findTarget(step)
    setRect(el ? rectOf(el) : null)
  }, [step])

  // Measure now, and only scroll if the target is off-screen.
  useEffect(() => {
    if (!step) return
    const el = findTarget(step)
    if (el) {
      const r = el.getBoundingClientRect()
      const onScreen = r.top >= 8 && r.bottom <= window.innerHeight - 8
      if (!onScreen) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    measure()
    const raf = requestAnimationFrame(measure)
    const settle = setTimeout(measure, 360)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(settle)
    }
  }, [step, measure])

  // Keep the highlight glued to the target as the page scrolls or resizes.
  useEffect(() => {
    if (!tour) return
    const onMove = () => measure()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [tour, measure])

  const go = useCallback(
    (dir: 1 | -1) => {
      const next = index + dir
      if (next < 0) return
      if (next >= steps.length) {
        onClose(true)
        return
      }
      setIndex(next)
    },
    [index, steps.length, onClose],
  )

  useEffect(() => {
    if (!tour) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false)
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        go(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour, go, onClose])

  if (!tour || !step || !mounted) return null

  const isFirst = index === 0
  const isLast = index === steps.length - 1

  const overlay = (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`${tour.label} walkthrough`}>
      {rect ? (
        <>
          {/* four dark panels around the target leave it fully visible and un-dimmed */}
          <div className="tour-mask" style={{ top: 0, left: 0, width: '100vw', height: Math.max(0, rect.top - RING) }} />
          <div
            className="tour-mask"
            style={{ top: rect.top - RING, left: 0, width: Math.max(0, rect.left - RING), height: rect.height + RING * 2 }}
          />
          <div
            className="tour-mask"
            style={{
              top: rect.top - RING,
              left: rect.left + rect.width + RING,
              width: `calc(100vw - ${rect.left + rect.width + RING}px)`,
              height: rect.height + RING * 2,
            }}
          />
          <div
            className="tour-mask"
            style={{ top: rect.top + rect.height + RING, left: 0, width: '100vw', height: `calc(100vh - ${rect.top + rect.height + RING}px)` }}
          />
          <div
            className="tour-ring"
            style={{ top: rect.top - RING, left: rect.left - RING, width: rect.width + RING * 2, height: rect.height + RING * 2 }}
          />
        </>
      ) : (
        <div className="tour-scrim is-dark" />
      )}
      <div className={`tour-pop${rect ? '' : ' tour-pop-center'}`} style={popStyle(rect, step.placement)}>
        <div className="tour-pop-top">
          <span className="tour-pop-count">
            {index + 1} / {steps.length}
          </span>
          <button type="button" className="tour-pop-close" onClick={() => onClose(false)} aria-label="Close tour">
            Skip
          </button>
        </div>
        <h3 className="tour-pop-title">{step.title}</h3>
        <p className="tour-pop-body">{step.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, di) => (
            <span key={di} className={`tour-dot${di === index ? ' is-on' : ''}`} />
          ))}
        </div>
        <div className="tour-pop-actions">
          <button type="button" className="btn btn-ghost" onClick={() => go(-1)} disabled={isFirst}>
            Back
          </button>
          <button type="button" className="btn btn-accent" onClick={() => go(1)}>
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
