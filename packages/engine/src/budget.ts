export class BudgetExceededError extends Error {
  constructor(message = 'investigation budget exhausted') {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

export interface BudgetStats {
  toolCalls: number
  wallMs: number
}

export interface Budget {
  signal: AbortSignal
  readonly exceeded: boolean
  tryConsume(): boolean
  stats(): BudgetStats
  dispose(): void
}

export function createBudget(limits: { maxToolCalls: number; maxWallMs: number }): Budget {
  const controller = new AbortController()
  const startedAt = Date.now()
  let toolCalls = 0
  let exceeded = false

  const exhaust = (reason: string) => {
    exceeded = true
    if (!controller.signal.aborted) controller.abort(new BudgetExceededError(reason))
  }

  const timer = setTimeout(() => exhaust(`wall-clock budget of ${limits.maxWallMs}ms exhausted`), limits.maxWallMs)
  timer.unref?.()

  return {
    signal: controller.signal,
    get exceeded() {
      return exceeded
    },
    tryConsume() {
      if (exceeded) return false
      if (toolCalls >= limits.maxToolCalls) {
        exhaust(`tool-call budget of ${limits.maxToolCalls} exhausted`)
        return false
      }
      toolCalls += 1
      return true
    },
    stats() {
      return { toolCalls, wallMs: Date.now() - startedAt }
    },
    dispose() {
      clearTimeout(timer)
    },
  }
}
