// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HealthBadge } from '../src/components/HealthBadge'

afterEach(cleanup)

describe('HealthBadge', () => {
  it('shows a pulsing checking state', () => {
    render(<HealthBadge state="checking" />)
    const el = screen.getByText('checking')
    expect(el.className).toContain('health-checking')
    expect(el.querySelector('.dot.pulse')).not.toBeNull()
  })

  it('shows healthy for an ok result', () => {
    render(<HealthBadge state={{ ok: true }} />)
    const el = screen.getByText('healthy')
    expect(el.className).toContain('health-ok')
  })

  it('shows unhealthy with the message as a title for a failed result', () => {
    render(<HealthBadge state={{ ok: false, message: 'connection refused' }} />)
    const el = screen.getByText('unhealthy')
    expect(el.className).toContain('health-error')
    expect(el.title).toBe('connection refused')
  })
})
