export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3400'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type IncidentStatus = 'open' | 'investigating' | 'diagnosed' | 'resolved'
export type Verdict = 'confirmed' | 'rejected' | 'partial'
export type OrgRole = 'owner' | 'admin' | 'member'
export type PluginKind =
  | 'alert-source'
  | 'telemetry-source'
  | 'context-source'
  | 'notification-sink'
  | 'action-sink'
export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'url' | 'enum'

export interface User {
  id: string
  email: string
  name: string
}

export interface Org {
  id: string
  name: string
  slug: string
  role: OrgRole
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

export interface PublicManifest {
  id: string
  name: string
  version: string
  kind: PluginKind
  description: string
  sdkVersion: string
}

export interface ConfigFieldDescriptor {
  key: string
  type: ConfigFieldType
  required: boolean
  secret: boolean
  description?: string
  default?: string | number | boolean
  enumValues?: string[]
}

export interface ConfigDescriptor {
  config: ConfigFieldDescriptor[]
  credentials: ConfigFieldDescriptor[]
}

export interface PluginManifestInfo {
  manifest: PublicManifest
  descriptor: ConfigDescriptor
}

export interface PluginInstanceView {
  id: string
  projectId: string
  pluginId: string
  kind: PluginKind
  name: string
  enabled: boolean
  config: Record<string, unknown>
  credentials: Record<string, 'set' | 'unset'>
  createdAt: string
  ingestUrl?: string
}

export interface CreateInstanceBody {
  pluginId: string
  name: string
  config: Record<string, unknown>
  credentials: Record<string, unknown>
}

export interface UpdateInstanceBody {
  name?: string
  config?: Record<string, unknown>
  credentials?: Record<string, unknown>
  enabled?: boolean
}

export type ReviewStatus = 'draft' | 'approved'

export interface ReviewBody {
  summary: string
  timeline: Array<{ at: string; text: string }>
  rootCause: string
  contributingFactors: string[]
  actionItems: string[]
  evidenceRefs: string[]
}

export interface IncidentReview {
  id: string
  incidentId: string
  status: ReviewStatus
  generated: ReviewBody
  edited: ReviewBody | null
  approvedBy: string | null
  approvedAt: string | null
  createdAt: string
  updatedAt: string
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

export function listPlugins(): Promise<PluginManifestInfo[]> {
  return apiFetch('/api/plugins')
}

export function listInstances(projectId: string): Promise<PluginInstanceView[]> {
  return apiFetch(`/api/projects/${projectId}/instances`)
}

export function createInstance(projectId: string, body: CreateInstanceBody): Promise<PluginInstanceView> {
  return apiFetch(`/api/projects/${projectId}/instances`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateInstance(id: string, body: UpdateInstanceBody): Promise<PluginInstanceView> {
  return apiFetch(`/api/instances/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteInstance(id: string): Promise<void> {
  return apiFetch(`/api/instances/${id}`, { method: 'DELETE' })
}

export function checkInstanceHealth(id: string): Promise<{ ok: boolean; message?: string }> {
  return apiFetch(`/api/instances/${id}/health`, { method: 'POST' })
}

export function getReview(incidentId: string): Promise<IncidentReview> {
  return apiFetch(`/api/incidents/${incidentId}/review`)
}

export function generateReview(incidentId: string): Promise<IncidentReview> {
  return apiFetch(`/api/incidents/${incidentId}/review`, { method: 'POST' })
}

export function updateReview(incidentId: string, edited: ReviewBody): Promise<IncidentReview> {
  return apiFetch(`/api/incidents/${incidentId}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ edited }),
  })
}

export function approveReview(incidentId: string): Promise<IncidentReview> {
  return apiFetch(`/api/incidents/${incidentId}/review/approve`, { method: 'POST' })
}

export function reviewExportUrl(incidentId: string): string {
  return `${API_URL}/api/incidents/${incidentId}/review/export`
}

export type RunbookSourceKind = 'upload' | 'paste' | 'url'

export interface Runbook {
  id: string
  projectId: string
  title: string
  sourceKind: RunbookSourceKind
  sourceRef: string | null
  content: string
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export interface CreateRunbookBody {
  title: string
  sourceKind: RunbookSourceKind
  sourceRef?: string
  content?: string
}

export function listRunbooks(projectId: string): Promise<Runbook[]> {
  return apiFetch(`/api/projects/${projectId}/runbooks`)
}

export function createRunbook(projectId: string, body: CreateRunbookBody): Promise<Runbook> {
  return apiFetch(`/api/projects/${projectId}/runbooks`, { method: 'POST', body: JSON.stringify(body) })
}

export function deleteRunbook(id: string): Promise<void> {
  return apiFetch(`/api/runbooks/${id}`, { method: 'DELETE' })
}

export interface AuthConfig {
  password: boolean
  oidc: { enabled: boolean; buttonLabel: string }
}

export const oidcStartUrl = `${API_URL}/api/auth/oidc/start`

export function getAuthConfig(): Promise<AuthConfig> {
  return apiFetch('/api/auth/config')
}
