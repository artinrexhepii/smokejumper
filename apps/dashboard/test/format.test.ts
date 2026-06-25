import { describe, expect, it } from 'vitest'
import { formatAgo, formatConfidence } from '../src/lib/format'

const now = new Date('2026-07-04T12:00:00.000Z')

describe('formatAgo', () => {
  it('renders sub-minute ages as just now', () => {
    expect(formatAgo('2026-07-04T11:59:30.000Z', now)).toBe('just now')
  })

  it('renders minutes', () => {
    expect(formatAgo('2026-07-04T11:15:00.000Z', now)).toBe('45m ago')
  })

  it('renders hours', () => {
    expect(formatAgo('2026-07-04T07:00:00.000Z', now)).toBe('5h ago')
  })

  it('renders days', () => {
    expect(formatAgo('2026-07-01T12:00:00.000Z', now)).toBe('3d ago')
  })

  it('treats invalid dates as just now', () => {
    expect(formatAgo('nope', now)).toBe('just now')
  })
})

describe('formatConfidence', () => {
  it('renders fractional confidence as a percentage', () => {
    expect(formatConfidence(0.85)).toBe('85%')
  })

  it('renders 1 as 100%', () => {
    expect(formatConfidence(1)).toBe('100%')
  })

  it('tolerates values already expressed as percentages', () => {
    expect(formatConfidence(85)).toBe('85%')
  })

  it('renders non-finite values as a dash', () => {
    expect(formatConfidence(Number.NaN)).toBe('—')
  })
})
