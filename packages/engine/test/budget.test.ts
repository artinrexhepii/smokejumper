import { afterEach, describe, expect, it, vi } from 'vitest'
import { BudgetExceededError, createBudget } from '../src/budget'

describe('createBudget', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows exactly maxToolCalls consumptions, then aborts', () => {
    const budget = createBudget({ maxToolCalls: 2, maxWallMs: 60_000 })
    expect(budget.tryConsume()).toBe(true)
    expect(budget.tryConsume()).toBe(true)
    expect(budget.exceeded).toBe(false)
    expect(budget.tryConsume()).toBe(false)
    expect(budget.exceeded).toBe(true)
    expect(budget.signal.aborted).toBe(true)
    expect(budget.signal.reason).toBeInstanceOf(BudgetExceededError)
    budget.dispose()
  })

  it('aborts when the wall clock expires', () => {
    vi.useFakeTimers()
    const budget = createBudget({ maxToolCalls: 5, maxWallMs: 1_000 })
    expect(budget.exceeded).toBe(false)
    vi.advanceTimersByTime(1_001)
    expect(budget.exceeded).toBe(true)
    expect(budget.signal.aborted).toBe(true)
    expect(budget.tryConsume()).toBe(false)
    budget.dispose()
  })

  it('tracks stats', () => {
    const budget = createBudget({ maxToolCalls: 5, maxWallMs: 60_000 })
    budget.tryConsume()
    budget.tryConsume()
    const stats = budget.stats()
    expect(stats.toolCalls).toBe(2)
    expect(stats.wallMs).toBeGreaterThanOrEqual(0)
    budget.dispose()
  })

  it('dispose cancels the wall clock timer', () => {
    vi.useFakeTimers()
    const budget = createBudget({ maxToolCalls: 5, maxWallMs: 1_000 })
    budget.dispose()
    vi.advanceTimersByTime(5_000)
    expect(budget.exceeded).toBe(false)
    expect(budget.signal.aborted).toBe(false)
  })
})
