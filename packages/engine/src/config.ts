export type ModelProvider = 'anthropic' | 'google'

export interface EngineModels {
  provider: ModelProvider
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

const DEFAULT_MODELS: Record<ModelProvider, Omit<EngineModels, 'provider'>> = {
  anthropic: {
    triage: 'claude-haiku-4-5-20251001',
    investigator: 'claude-sonnet-5',
    synthesis: 'claude-sonnet-5',
  },
  google: {
    triage: 'gemini-2.5-flash',
    investigator: 'gemini-2.5-pro',
    synthesis: 'gemini-2.5-pro',
  },
}

function detectProvider(env: Record<string, string | undefined>): ModelProvider {
  const explicit = env.SMOKEJUMPER_MODEL_PROVIDER?.trim().toLowerCase()
  if (explicit === 'anthropic' || explicit === 'google') return explicit

  const hasGemini = Boolean(
    env.GEMINI_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_API_KEY,
  )
  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY)

  if (hasGemini && hasAnthropic) {
    console.warn(
      'smokejumper: both ANTHROPIC_API_KEY and a Gemini key are set; defaulting to anthropic. ' +
        'Set SMOKEJUMPER_MODEL_PROVIDER=google to run on Gemini.',
    )
    return 'anthropic'
  }
  if (hasGemini) return 'google'
  return 'anthropic'
}

export function resolveEngineConfig(
  opts: { models?: EngineModels | 'fake'; budgets?: Partial<EngineBudgets> },
  env: Record<string, string | undefined> = process.env,
): EngineConfig {
  let models: EngineModels | 'fake'
  if (opts.models) {
    models = opts.models
  } else if (env.SMOKEJUMPER_FAKE_MODEL === '1') {
    models = 'fake'
  } else {
    const provider = detectProvider(env)
    const defaults = DEFAULT_MODELS[provider]
    models = {
      provider,
      triage: env.SMOKEJUMPER_TRIAGE_MODEL ?? defaults.triage,
      investigator: env.SMOKEJUMPER_INVESTIGATOR_MODEL ?? defaults.investigator,
      synthesis: env.SMOKEJUMPER_SYNTHESIS_MODEL ?? defaults.synthesis,
    }
  }
  return {
    models,
    budgets: {
      maxToolCalls: opts.budgets?.maxToolCalls ?? DEFAULT_BUDGETS.maxToolCalls,
      maxWallMs: opts.budgets?.maxWallMs ?? DEFAULT_BUDGETS.maxWallMs,
    },
  }
}
