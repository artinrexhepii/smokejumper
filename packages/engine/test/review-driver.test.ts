import { describe, expect, it } from 'vitest'
import { createFakeDriver } from '../src/fake-driver'
import { reviewResultSchema, type ReviewInput } from '../src/driver'

const signal = new AbortController().signal
const driver = createFakeDriver()

function input(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    incident: { title: 'api: OOMKilled', severity: 'critical', service: 'api' },
    diagnosis: { rootCause: 'memory leak', confidence: 0.8, remediation: 'roll back', openQuestions: [] },
    findings: [{ specialist: 'log-analyst', summary: 'api OOM-killed at 10:15', evidenceIds: ['ev-1'] }],
    evidence: [{ id: 'ev-1', toolName: 'docker_container_logs', summary: 'OOM kill observed' }],
    ...overrides,
  }
}

describe('reviewResultSchema', () => {
  it('accepts a complete review result', () => {
    expect(
      reviewResultSchema.safeParse({
        summary: 's',
        timeline: [{ at: 't', text: 'x' }],
        rootCause: 'r',
        contributingFactors: ['f'],
        actionItems: ['a'],
        evidenceRefs: ['ev-1'],
      }).success,
    ).toBe(true)
  })

  it('rejects a result missing a required field', () => {
    expect(
      reviewResultSchema.safeParse({
        summary: 's',
        timeline: [],
        rootCause: 'r',
        contributingFactors: [],
        actionItems: [],
      }).success,
    ).toBe(false)
  })
})

describe('fake driver draftReview', () => {
  it('deterministically drafts a review grounded in the ordered evidence', async () => {
    const first = await driver.draftReview(input(), { signal })
    const second = await driver.draftReview(input(), { signal })
    expect(first).toEqual(second)
    expect(first.timeline).toEqual([{ at: 'step-1', text: 'docker_container_logs: OOM kill observed' }])
    expect(first.rootCause).toBe('memory leak')
    expect(first.actionItems).toEqual(['roll back'])
    expect(first.evidenceRefs).toEqual(['ev-1'])
    expect(reviewResultSchema.safeParse(first).success).toBe(true)
  })

  it('falls back to an undiagnosed root cause and generic action item when there is no diagnosis', async () => {
    const result = await driver.draftReview(input({ diagnosis: undefined }), { signal })
    expect(result.rootCause).toContain('No diagnosis')
    expect(result.actionItems).toEqual(['Confirm the fake root cause against the real telemetry.'])
  })
})
