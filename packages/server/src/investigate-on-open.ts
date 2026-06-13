import type { IncidentEvent } from '@smokejumper/plugin-sdk'

export interface InvestigatorLike {
  investigate(incidentId: string): Promise<void>
}

interface BusLike {
  subscribe(fn: (event: IncidentEvent) => void): () => void
}

export function investigateOnOpen(opts: {
  bus: BusLike
  investigator: InvestigatorLike
  onError?: (incidentId: string, err: unknown) => void
}): () => void {
  const running = new Set<string>()
  const onError =
    opts.onError ??
    ((incidentId: string, err: unknown) =>
      console.error(`[server] investigation for ${incidentId} failed`, err))
  return opts.bus.subscribe((event) => {
    if (event.type !== 'incident.opened') return
    if (running.has(event.incidentId)) return
    running.add(event.incidentId)
    void opts.investigator
      .investigate(event.incidentId)
      .catch((err) => onError(event.incidentId, err))
      .finally(() => running.delete(event.incidentId))
  })
}
