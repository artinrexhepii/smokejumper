'use client'

import { useCallback, useEffect, useState } from 'react'
import { deleteRunbook, listProjects, listRunbooks, type Project, type Runbook } from '../../../lib/api'
import { canManageOrg, useSession } from '../../../lib/useSession'
import { RunbookForm } from '../../../components/RunbookForm'

type Mode = { type: 'list' } | { type: 'add' }

export default function RunbookSettingsPage() {
  const { session, loading, error } = useSession()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [runbooks, setRunbooks] = useState<Runbook[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>({ type: 'list' })
  const [reloadToken, setReloadToken] = useState(0)

  const orgs = session?.orgs.filter((org) => canManageOrg(org.role)) ?? []
  const activeOrgId = orgId ?? orgs[0]?.id ?? null

  useEffect(() => {
    if (!activeOrgId) return
    let cancelled = false
    listProjects(activeOrgId)
      .then((list) => {
        if (cancelled) return
        setProjects(list)
        setProjectId((current) => current ?? list[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setListError('Could not load projects.')
      })
    return () => {
      cancelled = true
    }
  }, [activeOrgId])

  const activeProjectId = projectId ?? projects?.[0]?.id ?? null

  const refetch = useCallback(() => {
    if (!activeProjectId) return
    listRunbooks(activeProjectId)
      .then((list) => {
        setRunbooks(list)
        setListError(null)
      })
      .catch(() => setListError('Could not load runbooks.'))
  }, [activeProjectId])

  useEffect(() => {
    refetch()
  }, [refetch, reloadToken])

  async function confirmDelete(id: string) {
    try {
      await deleteRunbook(id)
      setConfirmingDeleteId(null)
      setReloadToken((t) => t + 1)
    } catch {
      setListError('Could not delete the runbook — try again.')
    }
  }

  function onSaved() {
    setMode({ type: 'list' })
    setReloadToken((t) => t + 1)
  }

  if (loading) return <p className="loading">Loading…</p>
  if (error) return <p className="error-text">{error}</p>
  if (!session) return null
  if (orgs.length === 0) {
    return <p className="empty">You are not an owner or admin of any organization.</p>
  }

  return (
    <>
      <div className="feed-head">
        <h1>Runbooks</h1>
        <div className="settings-selects">
          <select
            aria-label="Organization"
            value={activeOrgId ?? ''}
            onChange={(e) => {
              setOrgId(e.target.value)
              setProjectId(null)
              setProjects(null)
              setRunbooks(null)
              setMode({ type: 'list' })
            }}
          >
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Project"
            value={activeProjectId ?? ''}
            onChange={(e) => {
              setProjectId(e.target.value)
              setRunbooks(null)
              setMode({ type: 'list' })
            }}
          >
            {(projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {listError ? <p className="error-text">{listError}</p> : null}
      {mode.type === 'add' ? (
        <RunbookForm
          projectId={activeProjectId ?? ''}
          onSaved={onSaved}
          onCancel={() => setMode({ type: 'list' })}
        />
      ) : (
        <>
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => setMode({ type: 'add' })}
              disabled={!activeProjectId}
            >
              Add runbook
            </button>
          </div>
          {runbooks === null ? (
            <p className="loading">Loading runbooks…</p>
          ) : runbooks.length === 0 ? (
            <p className="empty">No runbooks added for this project.</p>
          ) : (
            <ul className="instance-list">
              {runbooks.map((runbook) => (
                <li key={runbook.id} className="instance-row">
                  <span className="badge">{runbook.sourceKind}</span>
                  <span className="instance-name">{runbook.title}</span>
                  <span className="badge">{runbook.chunkCount} chunks</span>
                  {confirmingDeleteId === runbook.id ? (
                    <span className="confirm-delete">
                      <button type="button" className="btn" onClick={() => confirmDelete(runbook.id)}>
                        confirm delete
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setConfirmingDeleteId(null)}
                      >
                        cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setConfirmingDeleteId(runbook.id)}
                    >
                      delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}
