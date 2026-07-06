import { getIncidentDetail, type Db, type ReviewBody } from '@smokejumper/db'
import type { ModelDriver } from './driver'

export async function draftIncidentReview(opts: {
  db: Db
  incidentId: string
  driver: ModelDriver
}): Promise<ReviewBody> {
  const detail = await getIncidentDetail(opts.db, opts.incidentId)
  if (!detail) throw new Error(`incident ${opts.incidentId} not found`)
  const { incident, diagnosis, findings, evidence } = detail
  const knownEvidenceIds = new Set(evidence.map((record) => record.id))
  const result = await opts.driver.draftReview({
    incident: { title: incident.title, severity: incident.severity, service: incident.service },
    diagnosis: diagnosis
      ? {
          rootCause: diagnosis.rootCause,
          confidence: diagnosis.confidence,
          remediation: diagnosis.remediation,
          openQuestions: diagnosis.openQuestions,
        }
      : undefined,
    findings: findings.map((finding) => ({
      specialist: finding.specialist,
      summary: finding.summary,
      evidenceIds: finding.evidenceIds,
    })),
    evidence: evidence.map((record) => ({ id: record.id, toolName: record.toolName, summary: record.summary })),
  })
  return {
    summary: result.summary,
    timeline: result.timeline,
    rootCause: result.rootCause,
    contributingFactors: result.contributingFactors,
    actionItems: result.actionItems,
    evidenceRefs: [...new Set(result.evidenceRefs)].filter((id) => knownEvidenceIds.has(id)),
  }
}
