import { Agent } from '@mastra/core/agent'
import { beforeEach, describe, expect, it } from 'vitest'
import { createAnthropicDriver } from '../src/anthropic-driver'

const models = {
  triage: 'claude-haiku-4-5-20251001',
  investigator: 'claude-sonnet-5',
  synthesis: 'claude-sonnet-5',
}

describe('createAnthropicDriver', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
  })

  it('constructs without an API key or network access', () => {
    const driver = createAnthropicDriver(models)
    expect(driver.triage).toBeTypeOf('function')
    expect(driver.plan).toBeTypeOf('function')
    expect(driver.runSpecialist).toBeTypeOf('function')
    expect(driver.synthesize).toBeTypeOf('function')
  })

  it('constructs a Mastra agent with a router model string without an API key', () => {
    const agent = new Agent({
      id: 'smokejumper-probe',
      name: 'Smokejumper Probe',
      instructions: 'probe',
      model: 'anthropic/claude-sonnet-5',
    })
    expect(agent).toBeDefined()
  })
})
