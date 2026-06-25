// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useIncidentEvents } from '../src/lib/useIncidentEvents'

class FakeEventSource {
  static instances: FakeEventSource[] = []

  static last(): FakeEventSource {
    return FakeEventSource.instances.at(-1)!
  }

  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this)
  }

  close() {
    this.closed = true
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

vi.stubGlobal('EventSource', FakeEventSource)

afterEach(() => {
  cleanup()
  FakeEventSource.instances = []
})

function event(type: string, occurredAt: string, payload: Record<string, unknown> = {}) {
  return { type, incidentId: 'inc-1', projectId: 'proj-1', occurredAt, payload }
}

describe('useIncidentEvents', () => {
  it('opens an EventSource against the incident stream with credentials', () => {
    renderHook(() => useIncidentEvents('inc-1'))
    const source = FakeEventSource.last()
    expect(source.url).toBe('http://localhost:3400/api/incidents/inc-1/events')
    expect(source.init?.withCredentials).toBe(true)
  })

  it('accumulates dispatched events into ordered steps', () => {
    const { result } = renderHook(() => useIncidentEvents('inc-1'))
    act(() => {
      FakeEventSource.last().emit(event('investigation.started', '2026-07-04T10:00:00.000Z'))
      FakeEventSource.last().emit(
        event('investigation.milestone', '2026-07-04T10:00:05.000Z', { phase: 'triage' }),
      )
    })
    expect(result.current.steps.map((s) => s.title)).toEqual([
      'Investigation started',
      'Milestone — triage',
    ])
  })

  it('fires the diagnosis callback, tracks connection state, and closes on unmount', () => {
    const onReady = vi.fn()
    const { result, unmount } = renderHook(() => useIncidentEvents('inc-1', onReady))
    expect(result.current.connection).toBe('connecting')
    act(() => FakeEventSource.last().onopen?.())
    expect(result.current.connection).toBe('live')
    act(() => FakeEventSource.last().emit(event('diagnosis.ready', '2026-07-04T10:01:00.000Z')))
    expect(onReady).toHaveBeenCalledTimes(1)
    act(() => FakeEventSource.last().onerror?.())
    expect(result.current.connection).toBe('reconnecting')
    const source = FakeEventSource.last()
    unmount()
    expect(source.closed).toBe(true)
  })

  it('ignores frames that are not valid JSON', () => {
    const { result } = renderHook(() => useIncidentEvents('inc-1'))
    act(() => {
      FakeEventSource.last().onmessage?.({ data: 'not-json' } as MessageEvent)
    })
    expect(result.current.steps).toEqual([])
  })
})
