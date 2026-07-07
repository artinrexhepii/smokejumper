import { Agent } from '@mastra/core/agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createModelDriver, renderSynthesisPrompt } from '../src/model-driver'
import type { EngineModels } from '../src/config'

const anthropicModels: EngineModels = {
  provider: 'anthropic',
  triage: 'claude-haiku-4-5-20251001',
  investigator: 'claude-sonnet-5',
  synthesis: 'claude-sonnet-5',
}

const googleModels: EngineModels = {
  provider: 'google',
  triage: 'gemini-2.5-flash',
  investigator: 'gemini-2.5-pro',
  synthesis: 'gemini-2.5-pro',
}

describe('createModelDriver', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
  })
  afterEach(() => {
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
  })

  it('constructs without an API key or network access', () => {
    const driver = createModelDriver(anthropicModels)
    expect(driver.triage).toBeTypeOf('function')
    expect(driver.plan).toBeTypeOf('function')
    expect(driver.runSpecialist).toBeTypeOf('function')
    expect(driver.synthesize).toBeTypeOf('function')
    expect(driver.draftReview).toBeTypeOf('function')
  })

  it('constructs a Mastra agent with an anthropic router model string', () => {
    const agent = new Agent({
      id: 'smokejumper-probe',
      name: 'Smokejumper Probe',
      instructions: 'probe',
      model: 'anthropic/claude-sonnet-5',
    })
    expect(agent).toBeDefined()
  })

  it('constructs a Mastra agent with a google router model string', () => {
    const agent = new Agent({
      id: 'smokejumper-probe-google',
      name: 'Smokejumper Probe Google',
      instructions: 'probe',
      model: 'google/gemini-2.5-pro',
    })
    expect(agent).toBeDefined()
  })

  it('bridges GEMINI_API_KEY to GOOGLE_GENERATIVE_AI_API_KEY for the google provider', () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    createModelDriver(googleModels)
    expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe('test-gemini-key')
  })

  it('does not overwrite an existing GOOGLE_GENERATIVE_AI_API_KEY', () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'already-set'
    createModelDriver(googleModels)
    expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe('already-set')
  })
})

describe('renderSynthesisPrompt', () => {
  it('includes runbook passages as advisory context when present', () => {
    const prompt = renderSynthesisPrompt({
      brief: 'brief',
      findings: [],
      evidence: [],
      pastIncidents: [],
      runbooks: [{ content: 'restart the pods', similarity: 0.87, title: 'Restart guide' }],
    })
    expect(prompt).toContain('Restart guide')
    expect(prompt).toContain('restart the pods')
    expect(prompt).toContain('advisory context')
  })

  it('notes the absence of runbook passages when none are supplied', () => {
    const prompt = renderSynthesisPrompt({ brief: 'brief', findings: [], evidence: [], pastIncidents: [] })
    expect(prompt).toContain('No relevant runbook passages found.')
  })
})
