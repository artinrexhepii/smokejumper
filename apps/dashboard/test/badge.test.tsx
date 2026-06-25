// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SeverityBadge, StatusBadge } from '../src/components/Badge'

afterEach(cleanup)

describe('SeverityBadge', () => {
  it('renders the severity label with its color class', () => {
    render(<SeverityBadge severity="critical" />)
    const el = screen.getByText('critical')
    expect(el.className).toContain('badge')
    expect(el.className).toContain('sev-critical')
  })
})

describe('StatusBadge', () => {
  it('marks investigating with a pulsing dot', () => {
    render(<StatusBadge status="investigating" />)
    const badge = screen.getByText('investigating')
    expect(badge.className).toContain('st-investigating')
    expect(badge.querySelector('.dot.pulse')).not.toBeNull()
  })

  it('renders resolved without a dot', () => {
    render(<StatusBadge status="resolved" />)
    const badge = screen.getByText('resolved')
    expect(badge.className).toContain('st-resolved')
    expect(badge.querySelector('.dot')).toBeNull()
  })
})
