export interface EngineModels {
  triage: string
  investigator: string
  synthesis: string
}

export interface EngineBudgets {
  maxToolCalls: number
  maxWallMs: number
}

export interface EngineConfig {
  models: EngineModels | 'fake'
  budgets: EngineBudgets
}

export const DEFAULT_BUDGETS: EngineBudgets = { maxToolCalls: 25, maxWallMs: 240_000 }

const DEFAULT_MODELS: EngineModels = {
  triage: 'claude-haiku-4-5-20251001',
  investigator: 'claude-sonnet-5',
  synthesis: 'claude-sonnet-5',
}

export function resolveEngineConfig(
  opts: { models?: EngineModels | 'fake'; budgets?: Partial<EngineBudgets> },
  env: Record<string, string | undefined> = process.env,
): EngineConfig {
  const models =
    opts.models ??
    (env.SMOKEJUMPER_FAKE_MODEL === '1'
      ? ('fake' as const)
      : {
          triage: env.SMOKEJUMPER_TRIAGE_MODEL ?? DEFAULT_MODELS.triage,
          investigator: env.SMOKEJUMPER_INVESTIGATOR_MODEL ?? DEFAULT_MODELS.investigator,
          synthesis: env.SMOKEJUMPER_SYNTHESIS_MODEL ?? DEFAULT_MODELS.synthesis,
        })
  return {
    models,
    budgets: {
      maxToolCalls: opts.budgets?.maxToolCalls ?? DEFAULT_BUDGETS.maxToolCalls,
      maxWallMs: opts.budgets?.maxWallMs ?? DEFAULT_BUDGETS.maxWallMs,
    },
  }
}
