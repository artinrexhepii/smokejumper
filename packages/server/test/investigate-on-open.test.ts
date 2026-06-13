import { createTestDb } from '@smokejumper/db'
import type { IncidentEvent } from '@smokejumper/plugin-sdk'
import { describe, expect, it } from 'vitest'
import { buildServer, createBus } from '../src/index.ts'
import { investigateOnOpen } from '../src/investigate-on-open.ts'

const encryptionKey = Buffer.alloc(32, 7).toString('base64')

function opened(incidentId: string): IncidentEvent {
  return { type: 'incident.opened', incidentId, projectId: 'proj-1', occurredAt: new Date().toISOString(), payload: {} }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('investigateOnOpen', () => {
  it('investigates new incidents once and dedups repeats while running', async () => {
    const bus = createBus()
    const calls: string[] = []
    const gate = deferred()
    const stop = investigateOnOpen({
      bus,
      investigator: {
        async investigate(id) {
          calls.push(id)
          await gate.promise
        },
      },
    })
    bus.publish(opened('inc-1'))
    bus.publish(opened('inc-1'))
    bus.publish(opened('inc-2'))
    expect(calls).toEqual(['inc-1', 'inc-2'])
    gate.resolve()
    await new Promise((r) => setTimeout(r, 0))
    bus.publish(opened('inc-1'))
    expect(calls).toEqual(['inc-1', 'inc-2', 'inc-1'])
    stop()
  })

  it('ignores non-opened events and logs investigation errors instead of throwing', async () => {
    const bus = createBus()
    const calls: string[] = []
    const errors: string[] = []
    const stop = investigateOnOpen({
      bus,
      investigator: {
        async investigate(id) {
          calls.push(id)
          throw new Error('boom')
        },
      },
      onError: (incidentId) => errors.push(incidentId),
    })
    bus.publish({ ...opened('inc-3'), type: 'diagnosis.ready' })
    bus.publish(opened('inc-3'))
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toEqual(['inc-3'])
    expect(errors).toEqual(['inc-3'])
    stop()
  })

  it('is wired into buildServer when an investigator is provided', async () => {
    const db = await createTestDb()
    const bus = createBus()
    const calls: string[] = []
    const app = await buildServer({
      db,
      encryptionKey,
      bus,
      investigator: {
        async investigate(id) {
          calls.push(id)
        },
      },
    })
    bus.publish(opened('inc-9'))
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toEqual(['inc-9'])
    await app.close()
  })
})
