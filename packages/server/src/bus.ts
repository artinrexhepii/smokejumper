import type { IncidentEvent } from '@smokejumper/plugin-sdk'

export interface IncidentBus {
  publish(event: IncidentEvent): void
  subscribe(fn: (event: IncidentEvent) => void): () => void
}

export function createBus(): IncidentBus {
  const subscribers = new Set<(event: IncidentEvent) => void>()
  return {
    publish(event) {
      for (const fn of [...subscribers]) fn(event)
    },
    subscribe(fn) {
      subscribers.add(fn)
      return () => {
        subscribers.delete(fn)
      }
    },
  }
}
