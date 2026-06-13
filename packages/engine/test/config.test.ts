import { describe, expect, it } from 'vitest'
import { resolveEngineConfig } from '../src/config'
import { synthesisResultSchema, triageResultSchema } from '../src/driver'

describe('resolveEngineConfig', () => {
  it('defaults models per the contracts doc and budgets to 25 calls / 4 minutes', () => {
    const config = resolveEngineConfig({}, {})
    expect(config.models).toEqual({
      triage: 'claude-haiku-4-5-20251001',
      investigator: 'claude-sonnet-5',
      synthesis: 'claude-sonnet-5',
    })
    expect(config.budgets).toEqual({ maxToolCalls: 25, maxWallMs: 240_000 })
  })

  it('reads model overrides from the environment', () => {
    const config = resolveEngineConfig(
      {},
      {
        SMOKEJUMPER_TRIAGE_MODEL: 'claude-haiku-x',
        SMOKEJUMPER_INVESTIGATOR_MODEL: 'claude-sonnet-x',
        SMOKEJUMPER_SYNTHESIS_MODEL: 'claude-opus-x',
      },
    )
    expect(config.models).toEqual({
      triage: 'claude-haiku-x',
      investigator: 'claude-sonnet-x',
      synthesis: 'claude-opus-x',
    })
  })

  it('switches to the fake driver via SMOKEJUMPER_FAKE_MODEL=1', () => {
    expect(resolveEngineConfig({}, { SMOKEJUMPER_FAKE_MODEL: '1' }).models).toBe('fake')
  })

  it('prefers explicit options over the environment and merges partial budgets', () => {
    const config = resolveEngineConfig(
      { models: { triage: 't', investigator: 'i', synthesis: 's' }, budgets: { maxToolCalls: 3 } },
      { SMOKEJUMPER_FAKE_MODEL: '1' },
    )
    expect(config.models).toEqual({ triage: 't', investigator: 'i', synthesis: 's' })
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
