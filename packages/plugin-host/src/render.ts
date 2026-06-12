import type { IncidentEvent, Rendering } from '@smokejumper/plugin-sdk'

function text(payload: Record<string, unknown>, key: string, fallback = ''): string {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function formatConfidence(value: unknown): string {
  if (typeof value === 'number') {
    return value <= 1 ? `${Math.round(value * 100)}%` : `${Math.round(value)}%`
  }
  if (typeof value === 'string' && value.length > 0) return value
  return 'unknown'
}

export function renderEvent(event: IncidentEvent): Rendering {
  const payload = event.payload
  switch (event.type) {
    case 'incident.opened':
      return {
        title: `Incident: ${text(payload, 'title', 'new incident')}`,
        markdown: [
          `**Severity:** ${text(payload, 'severity', 'unknown')}`,
          `**Service:** ${text(payload, 'service', 'unknown')}`,
          '',
          'Smokejumper is investigating.',
        ].join('\n'),
      }
    case 'investigation.started':
      return {
        title: 'Investigation started',
        markdown: `Smokejumper started investigating incident \`${event.incidentId}\`.`,
      }
    case 'investigation.milestone':
      return {
        title: `Investigation update: ${text(payload, 'phase', 'progress')}`,
        markdown: text(payload, 'summary', 'The investigation reached a new milestone.'),
      }
    case 'diagnosis.ready': {
      const lines = [
        `**Root cause:** ${text(payload, 'rootCause', 'see the dashboard for details')}`,
        `**Confidence:** ${formatConfidence(payload.confidence)}`,
      ]
      const remediation = text(payload, 'remediation')
      if (remediation) lines.push(`**Suggested remediation:** ${remediation}`)
      return { title: 'Diagnosis ready', markdown: lines.join('\n') }
    }
    case 'incident.resolved':
      return {
        title: 'Incident resolved',
        markdown: `Incident \`${event.incidentId}\` was resolved.`,
      }
  }
}
