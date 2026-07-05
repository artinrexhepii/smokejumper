'use client'

import { useEffect, useState } from 'react'
import {
  checkInstanceHealth,
  deleteInstance,
  listInstances,
  listProjects,
  updateInstance,
  type PluginInstanceView,
  type Project,
} from '../../../lib/api'
import { canManageOrg, useSession } from '../../../lib/useSession'
import { HealthBadge, type HealthState } from '../../../components/HealthBadge'

export default function PluginSettingsPage() {
  const { session, loading, error } = useSession()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [instances, setInstances] = useState<PluginInstanceView[] | null>(null)
  const [health, setHealth] = useState<Record<string, HealthState>>({})
  const [listError, setListError] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
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

  useEffect(() => {
    if (!activeProjectId) return
    let cancelled = false
    listInstances(activeProjectId)
      .then((list) => {
        if (cancelled) return
        setInstances(list)
        setListError(null)
        for (const instance of list) {
          setHealth((prev) => ({ ...prev, [instance.id]: 'checking' }))
          checkInstanceHealth(instance.id)
            .then((result) => {
              if (!cancelled) setHealth((prev) => ({ ...prev, [instance.id]: result }))
            })
            .catch(() => {
              if (!cancelled)
                setHealth((prev) => ({
                  ...prev,
                  [instance.id]: { ok: false, message: 'health check failed' },
                }))
            })
        }
      })
      .catch(() => {
        if (!cancelled) setListError('Could not load plugin instances.')
      })
    return () => {
      cancelled = true
    }
  }, [activeProjectId, reloadToken])

  async function toggleEnabled(instance: PluginInstanceView) {
    setInstances((prev) =>
      prev ? prev.map((i) => (i.id === instance.id ? { ...i, enabled: !i.enabled } : i)) : prev,
    )
    try {
      await updateInstance(instance.id, { enabled: !instance.enabled })
    } catch {
      setInstances((prev) =>
        prev ? prev.map((i) => (i.id === instance.id ? { ...i, enabled: instance.enabled } : i)) : prev,
      )
      setListError('Could not update the instance — try again.')
    }
  }

  async function confirmDelete(id: string) {
    try {
      await deleteInstance(id)
      setConfirmingDeleteId(null)
      setReloadToken((t) => t + 1)
    } catch {
      setListError('Could not delete the instance — try again.')
    }
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
        <h1>Plugin instances</h1>
        <div className="settings-selects">
          <select
            aria-label="Organization"
            value={activeOrgId ?? ''}
            onChange={(e) => {
              setOrgId(e.target.value)
              setProjectId(null)
              setProjects(null)
              setInstances(null)
              setHealth({})
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
              setInstances(null)
              setHealth({})
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
      {instances === null ? (
        <p className="loading">Loading plugin instances…</p>
      ) : instances.length === 0 ? (
        <p className="empty">No plugin instances configured for this project.</p>
      ) : (
        <ul className="instance-list">
          {instances.map((instance) => (
            <li key={instance.id} className="instance-row">
              <span className="badge">{instance.pluginId}</span>
              <span className="instance-name">{instance.name}</span>
              <HealthBadge state={health[instance.id] ?? 'checking'} />
              <button
                type="button"
                className={`btn${instance.enabled ? ' btn-active' : ''}`}
                onClick={() => toggleEnabled(instance)}
              >
                {instance.enabled ? 'enabled' : 'disabled'}
              </button>
              {confirmingDeleteId === instance.id ? (
                <span className="confirm-delete">
                  <button type="button" className="btn" onClick={() => confirmDelete(instance.id)}>
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
                  onClick={() => setConfirmingDeleteId(instance.id)}
                >
                  delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
