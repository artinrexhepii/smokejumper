'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import { API_URL, type IncidentEvent } from './api'
import { initialTraceState, traceReducer, type TraceStep } from './trace'

export type ConnectionState = 'connecting' | 'live' | 'reconnecting'

export function useIncidentEvents(
  incidentId: string,
  onDiagnosisReady?: () => void,
): { steps: TraceStep[]; connection: ConnectionState } {
  const [state, dispatch] = useReducer(traceReducer, initialTraceState)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const callbackRef = useRef(onDiagnosisReady)
  callbackRef.current = onDiagnosisReady

  useEffect(() => {
    dispatch({ type: 'reset' })
    setConnection('connecting')
    const source = new EventSource(`${API_URL}/api/incidents/${incidentId}/events`, {
      withCredentials: true,
    })
    source.onopen = () => setConnection('live')
    // EventSource reconnects on its own; onerror only drives the indicator.
    source.onerror = () => setConnection('reconnecting')
    source.onmessage = (message) => {
      let event: IncidentEvent
      try {
        event = JSON.parse(message.data as string) as IncidentEvent
      } catch {
        return
      }
      dispatch({ type: 'event', event })
      if (event.type === 'diagnosis.ready') callbackRef.current?.()
    }
    return () => source.close()
  }, [incidentId])

  return { steps: state.steps, connection }
}
