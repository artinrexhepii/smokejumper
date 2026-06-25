import { describe, expect, it } from 'vitest'
import { formatAgo } from '../src/lib/format'

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
