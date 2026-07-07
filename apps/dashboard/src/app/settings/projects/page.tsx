'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, createProject, listProjects, type Project } from '../../../lib/api'
import { useSession } from '../../../lib/useSession'

export default function ProjectsPage() {
  const { session, loading, error } = useSession()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const orgs = session?.orgs ?? []
  const activeOrgId = orgId ?? orgs[0]?.id ?? null
  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null
  const canManageActive = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  useEffect(() => {
    if (!activeOrgId) return
    let cancelled = false
    listProjects(activeOrgId)
      .then((list) => {
        if (!cancelled) {
          setProjects(list)
          setListError(null)
        }
      })
      .catch(() => {
        if (!cancelled) setListError('Could not load projects.')
      })
    return () => {
      cancelled = true
    }
  }, [activeOrgId, reload])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!activeOrgId || !name.trim()) return
    setPending(true)
    setFormError(null)
    setCreated(null)
    try {
      const project = await createProject(activeOrgId, name.trim())
      setName('')
      setCreated(project.name)
      setReload((r) => r + 1)
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.status === 409
          ? 'A project with that name already exists.'
          : 'Could not create the project.',
      )
    } finally {
      setPending(false)
    }
  }

  if (loading) return <p className="loading">Loading…</p>
  if (error) return <p className="error-text">{error}</p>
  if (!session) return null
  if (orgs.length === 0) return <p className="empty">You are not a member of any organization.</p>

  return (
    <>
      <div className="board-hero">
        <div>
          <span className="board-hero-eyebrow">Configure</span>
          <h1>Projects</h1>
          <p>A project groups one service&rsquo;s incidents, telemetry connections, and runbooks.</p>
        </div>
        {orgs.length > 1 ? (
          <select
            aria-label="Organization"
            value={activeOrgId ?? ''}
            onChange={(e) => {
              setOrgId(e.target.value)
              setProjects(null)
              setCreated(null)
            }}
          >
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {canManageActive ? (
        <div className="card" data-tour="projects-create">
          <h2>New project</h2>
          <form onSubmit={onCreate} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '0.75rem' }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Checkout API"
              aria-label="Project name"
              maxLength={80}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-accent" disabled={pending || name.trim().length === 0}>
              {pending ? 'Creating…' : 'Create project'}
            </button>
          </form>
          {formError ? <p className="error-text">{formError}</p> : null}
          {created ? <p className="install-note">Created “{created}”. Add telemetry to it under Sources.</p> : null}
          <p className="text-dim" style={{ fontSize: '0.8rem', margin: '0.6rem 0 0' }}>
            The URL slug is generated from the name automatically.
          </p>
        </div>
      ) : (
        <p className="policy-note">Only organization owners and admins can create projects.</p>
      )}

      <h3 data-tour="projects-list">Existing projects</h3>
      {listError ? <p className="error-text">{listError}</p> : null}
      {projects === null ? (
        <p className="loading">Loading projects…</p>
      ) : projects.length === 0 ? (
        <p className="empty">No projects yet{canManageActive ? ' — create the first one above.' : '.'}</p>
      ) : (
        <ol className="instance-list">
          {projects.map((project) => (
            <li key={project.id} className="instance-row">
              <span className="instance-name">{project.name}</span>
              <span className="badge mono">{project.slug}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
