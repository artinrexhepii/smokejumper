'use client'

import { useState, type FormEvent } from 'react'
import {
  createInstance,
  updateInstance,
  type ConfigFieldDescriptor,
  type PluginInstanceView,
  type PluginManifestInfo,
} from '../lib/api'

type FieldValues = Record<string, string | boolean>

function initialConfigValues(
  fields: ConfigFieldDescriptor[],
  existing?: Record<string, unknown>,
): FieldValues {
  const values: FieldValues = {}
  for (const field of fields) {
    const current = existing?.[field.key]
    if (field.type === 'boolean') {
      values[field.key] = typeof current === 'boolean' ? current : Boolean(field.default ?? false)
    } else {
      values[field.key] =
        current !== undefined && current !== null
          ? String(current)
          : field.default !== undefined
            ? String(field.default)
            : ''
    }
  }
  return values
}

function coerceConfigValue(field: ConfigFieldDescriptor, raw: string | boolean): unknown {
  if (field.type === 'boolean') return Boolean(raw)
  if (field.type === 'number') return raw === '' ? undefined : Number(raw)
  return raw === '' ? undefined : raw
}

interface Props {
  projectId: string
  pluginInfo: PluginManifestInfo
  initialInstance?: PluginInstanceView
  onSaved: (instance: PluginInstanceView) => void
  onCancel: () => void
  create?: typeof createInstance
  update?: typeof updateInstance
}

export function PluginInstanceForm({
  projectId,
  pluginInfo,
  initialInstance,
  onSaved,
  onCancel,
  create = createInstance,
  update = updateInstance,
}: Props) {
  const { descriptor } = pluginInfo
  const [name, setName] = useState(initialInstance?.name ?? '')
  const [configValues, setConfigValues] = useState<FieldValues>(() =>
    initialConfigValues(descriptor.config, initialInstance?.config),
  )
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(descriptor.credentials.map((field) => [field.key, ''])),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const config: Record<string, unknown> = {}
    for (const field of descriptor.config) {
      const value = coerceConfigValue(field, configValues[field.key] ?? '')
      if (value !== undefined) config[field.key] = value
    }
    // Server credentials are re-encrypted wholesale when provided, so only include keys the
    // user actually typed; omit `credentials` entirely on update to leave stored ones intact.
    const credentials: Record<string, unknown> = {}
    for (const field of descriptor.credentials) {
      const draft = secretDrafts[field.key]?.trim() ?? ''
      if (draft !== '') credentials[field.key] = draft
    }
    try {
      if (initialInstance) {
        const body: { name?: string; config: Record<string, unknown>; credentials?: Record<string, unknown> } =
          { name, config }
        if (Object.keys(credentials).length > 0) body.credentials = credentials
        const saved = await update(initialInstance.id, body)
        onSaved(saved)
      } else {
        const saved = await create(projectId, { pluginId: pluginInfo.manifest.id, name, config, credentials })
        onSaved(saved)
      }
    } catch {
      setError('Could not save the plugin instance — check the fields and try again.')
      setPending(false)
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>{initialInstance ? `Edit ${pluginInfo.manifest.name}` : `Add ${pluginInfo.manifest.name}`}</h2>
      <label>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      {descriptor.config.map((field) => (
        <label key={field.key}>
          {field.description ?? field.key}
          {field.required ? ' *' : ''}
          {field.type === 'boolean' ? (
            <input
              type="checkbox"
              checked={Boolean(configValues[field.key])}
              onChange={(e) =>
                setConfigValues((prev) => ({ ...prev, [field.key]: e.target.checked }))
              }
            />
          ) : field.type === 'enum' ? (
            <select
              value={String(configValues[field.key] ?? '')}
              required={field.required}
              onChange={(e) => setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            >
              <option value="" disabled>
                select…
              </option>
              {(field.enumValues ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
              value={String(configValues[field.key] ?? '')}
              required={field.required}
              onChange={(e) => setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            />
          )}
        </label>
      ))}
      {descriptor.credentials.map((field) => (
        <label key={field.key}>
          {field.description ?? field.key}
          {field.required ? ' *' : ''}
          {initialInstance?.credentials[field.key] === 'set' ? (
            <span className="hint">•••• set — leave blank to keep it</span>
          ) : null}
          <input
            type="password"
            value={secretDrafts[field.key] ?? ''}
            required={field.required && !initialInstance}
            onChange={(e) => setSecretDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))}
          />
        </label>
      ))}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <button type="submit" className="btn btn-accent" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  )
}
