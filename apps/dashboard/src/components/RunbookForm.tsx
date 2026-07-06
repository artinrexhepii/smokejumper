'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { createRunbook, type CreateRunbookBody, type Runbook, type RunbookSourceKind } from '../lib/api'

interface Props {
  projectId: string
  onSaved: (runbook: Runbook) => void
  onCancel: () => void
  create?: typeof createRunbook
}

export function RunbookForm({ projectId, onSaved, onCancel, create = createRunbook }: Props) {
  const [title, setTitle] = useState('')
  const [sourceKind, setSourceKind] = useState<RunbookSourceKind>('paste')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setContent(await file.text())
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const body: CreateRunbookBody =
      sourceKind === 'url' ? { title, sourceKind, sourceRef: url } : { title, sourceKind, content }
    try {
      const saved = await create(projectId, body)
      onSaved(saved)
    } catch {
      setError('Could not save the runbook — check the fields and try again.')
      setPending(false)
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Add runbook</h2>
      <label>
        Title
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label>
        Source
        <select value={sourceKind} onChange={(e) => setSourceKind(e.target.value as RunbookSourceKind)}>
          <option value="paste">Paste text</option>
          <option value="upload">Upload file</option>
          <option value="url">Fetch from URL</option>
        </select>
      </label>
      {sourceKind === 'url' ? (
        <label>
          URL
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
        </label>
      ) : sourceKind === 'upload' ? (
        <label>
          File
          <input type="file" accept=".md,.txt" onChange={onFileChange} required />
        </label>
      ) : (
        <label>
          Content
          <textarea value={content} onChange={(e) => setContent(e.target.value)} required rows={8} />
        </label>
      )}
      {error ? <p className="error-text">{error}</p> : null}
      <div className="form-actions">
        <button type="submit" className="btn btn-accent" disabled={pending}>
          Save
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
