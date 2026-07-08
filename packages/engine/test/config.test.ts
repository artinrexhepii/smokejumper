import { describe, expect, it } from 'vitest'
import { resolveEngineConfig } from '../src/config'
import { synthesisResultSchema, triageResultSchema } from '../src/driver'

describe('resolveEngineConfig', () => {
  it('defaults to Anthropic models when no keys are set', () => {
    const config = resolveEngineConfig({}, {})
    expect(config.models).toEqual({
      provider: 'anthropic',
      triage: 'claude-haiku-4-5-20251001',
      investigator: 'claude-sonnet-5',
      synthesis: 'claude-sonnet-5',
    })
    expect(config.budgets).toEqual({ maxToolCalls: 25, maxWallMs: 240_000 })
  })

  it('reads model overrides from the environment (Anthropic)', () => {
    const config = resolveEngineConfig(
      {},
      {
        ANTHROPIC_API_KEY: 'sk-ant',
        SMOKEJUMPER_TRIAGE_MODEL: 'claude-haiku-x',
        SMOKEJUMPER_INVESTIGATOR_MODEL: 'claude-sonnet-x',
        SMOKEJUMPER_SYNTHESIS_MODEL: 'claude-opus-x',
      },
    )
    expect(config.models).toEqual({
      provider: 'anthropic',
      triage: 'claude-haiku-x',
      investigator: 'claude-sonnet-x',
      synthesis: 'claude-opus-x',
    })
  })

  it('auto-detects Google and its defaults from GEMINI_API_KEY', () => {
    const config = resolveEngineConfig({}, { GEMINI_API_KEY: 'g-key' })
    expect(config.models).toEqual({
      provider: 'google',
      triage: 'gemini-2.5-flash',
      investigator: 'gemini-2.5-pro',
      synthesis: 'gemini-2.5-pro',
    })
  })

  it('also detects Google from GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY', () => {
    expect(resolveEngineConfig({}, { GOOGLE_GENERATIVE_AI_API_KEY: 'g' }).models).toMatchObject({
      provider: 'google',
    })
    expect(resolveEngineConfig({}, { GOOGLE_API_KEY: 'g' }).models).toMatchObject({
      provider: 'google',
    })
  })

  it('applies bare model overrides on top of the Google provider', () => {
    const config = resolveEngineConfig(
      {},
      { GEMINI_API_KEY: 'g', SMOKEJUMPER_INVESTIGATOR_MODEL: 'gemini-3-pro' },
    )
    expect(config.models).toMatchObject({ provider: 'google', investigator: 'gemini-3-pro' })
  })

  it('falls back to provider defaults when model env overrides are empty or whitespace', () => {
    // docker-compose injects `${VAR:-}` as an empty string, which `??` would pass through.
    const config = resolveEngineConfig(
      {},
      {
        GEMINI_API_KEY: 'g',
        SMOKEJUMPER_TRIAGE_MODEL: '',
        SMOKEJUMPER_INVESTIGATOR_MODEL: '   ',
        SMOKEJUMPER_SYNTHESIS_MODEL: '',
      },
    )
    expect(config.models).toEqual({
      provider: 'google',
      triage: 'gemini-2.5-flash',
      investigator: 'gemini-2.5-pro',
      synthesis: 'gemini-2.5-pro',
    })
  })

  it('prefers Anthropic when both keys are set', () => {
    const config = resolveEngineConfig({}, { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' })
    expect(config.models).toMatchObject({ provider: 'anthropic' })
  })

  it('honors SMOKEJUMPER_MODEL_PROVIDER=google over the both-keys default', () => {
    const config = resolveEngineConfig(
      {},
      { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', SMOKEJUMPER_MODEL_PROVIDER: 'google' },
    )
    expect(config.models).toMatchObject({ provider: 'google' })
  })

  it('lets SMOKEJUMPER_MODEL_PROVIDER override the key that is actually present', () => {
    const config = resolveEngineConfig(
      {},
      { GEMINI_API_KEY: 'g', SMOKEJUMPER_MODEL_PROVIDER: 'anthropic' },
    )
    expect(config.models).toMatchObject({ provider: 'anthropic' })
  })

  it('ignores an unrecognized SMOKEJUMPER_MODEL_PROVIDER and detects from the key', () => {
    const config = resolveEngineConfig(
      {},
      { GEMINI_API_KEY: 'g', SMOKEJUMPER_MODEL_PROVIDER: 'openai' },
    )
    expect(config.models).toMatchObject({ provider: 'google' })
  })

  it('switches to the fake driver via SMOKEJUMPER_FAKE_MODEL=1', () => {
    expect(resolveEngineConfig({}, { SMOKEJUMPER_FAKE_MODEL: '1' }).models).toBe('fake')
  })

  it('prefers explicit options over the environment and merges partial budgets', () => {
    const config = resolveEngineConfig(
      {
        models: { provider: 'anthropic', triage: 't', investigator: 'i', synthesis: 's' },
        budgets: { maxToolCalls: 3 },
      },
      { SMOKEJUMPER_FAKE_MODEL: '1' },
    )
    expect(config.models).toEqual({ provider: 'anthropic', triage: 't', investigator: 'i', synthesis: 's' })
    expect(config.budgets).toEqual({ maxToolCalls: 3, maxWallMs: 240_000 })
  })
})

describe('driver output schemas', () => {
  it('accepts a valid synthesis result and rejects out-of-range confidence', () => {
    const valid = {
      rootCause: 'OOM in api',
      confidence: 0.8,
      evidenceChain: [{ claim: 'memory grew', evidenceIds: ['ev-1'] }],
      remediation: 'raise the limit',
      openQuestions: [],
    }
    expect(synthesisResultSchema.safeParse(valid).success).toBe(true)
    expect(synthesisResultSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false)
  })

  it('validates triage results against the SDK severity enum', () => {
    const valid = { severity: 'high', affectedService: 'api', brief: 'investigate', questions: [] }
    expect(triageResultSchema.safeParse(valid).success).toBe(true)
    expect(triageResultSchema.safeParse({ ...valid, severity: 'urgent' }).success).toBe(false)
  })
})
