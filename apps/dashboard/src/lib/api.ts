export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3400'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type IncidentStatus = 'open' | 'investigating' | 'diagnosed' | 'resolved'
export type Verdict = 'confirmed' | 'rejected' | 'partial'

export interface User {
  id: string
  email: string
  name: string
}

export interface Org {
  id: string
  name: string
  slug: string
}

export interface Project {
  id: string
  name: string
  slug: string
}

export interface SessionInfo {
  user: User
  orgs: Org[]
}

export interface Incident {
  id: string
  status: IncidentStatus
  severity: Severity
  title: string
  service: string
  alertCount: number
  openedAt: string
  lastAlertAt: string
}

export interface Investigation {
  id: string
  status: 'running' | 'completed' | 'failed' | 'budget_exceeded'
}

export interface Finding {
  id: string
  specialist: string
  summary: string
  evidenceIds: string[]
}

export interface EvidenceRecord {
  id: string
  seq: number
  toolName: string
  summary: string
  input: unknown
  output: unknown
  createdAt: string
}

export interface EvidenceClaim {
  claim: string
  evidenceIds: string[]
  verified: boolean
}

export interface Diagnosis {
  id: string
  version: number
  rootCause: string
  confidence: number
  evidenceChain: EvidenceClaim[]
  remediation: string
  openQuestions: string[]
  humanVerdict: Verdict | null
  humanNote: string | null
}

export interface IncidentDetail {
  incident: Incident
  investigation?: Investigation
  findings: Finding[]
  diagnosis?: Diagnosis
  evidence: EvidenceRecord[]
}

export type IncidentEventType =
  | 'incident.opened'
  | 'investigation.started'
  | 'investigation.milestone'
  | 'diagnosis.ready'
  | 'incident.resolved'

export interface IncidentEvent {
  type: IncidentEventType
  incidentId: string
  projectId: string
  occurredAt: string
  payload: Record<string, unknown>
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' })
  if (!res.ok) {
    let message = `request failed with status ${res.status}`
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      message = body.message ?? body.error ?? message
    } catch {}
    throw new ApiError(res.status, message)
  }
  const text = await res.text()
  return (text === '' ? undefined : JSON.parse(text)) as T
}

export function login(email: string, password: string): Promise<{ user: User }> {
  return apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function logout(): Promise<void> {
  return apiFetch('/api/auth/logout', { method: 'POST' })
}

export function me(): Promise<SessionInfo> {
  return apiFetch('/api/me')
}

export function listProjects(orgId: string): Promise<Project[]> {
  return apiFetch(`/api/orgs/${orgId}/projects`)
}

export function listIncidents(projectId: string): Promise<Incident[]> {
  return apiFetch(`/api/projects/${projectId}/incidents`)
}

export function getIncident(id: string): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${id}`)
}

export function submitVerdict(diagnosisId: string, verdict: Verdict, note?: string): Promise<void> {
  return apiFetch(`/api/diagnoses/${diagnosisId}/verdict`, {
    method: 'POST',
    body: JSON.stringify({ verdict, note }),
  })
}
