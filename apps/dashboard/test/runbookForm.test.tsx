// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RunbookForm } from '../src/components/RunbookForm'
import type { Runbook } from '../src/lib/api'

afterEach(cleanup)

describe('RunbookForm', () => {
  it('creates a pasted runbook from the typed fields', async () => {
    const create = vi.fn(async () => ({}) as Runbook)
    render(<RunbookForm projectId="proj-1" onSaved={vi.fn()} onCancel={vi.fn()} create={create} />)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Restart guide' } })
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'Restart the pods.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('proj-1', {
        title: 'Restart guide',
        sourceKind: 'paste',
        content: 'Restart the pods.',
      }),
    )
  })

  it('switches to a url field and submits sourceRef instead of content', async () => {
    const create = vi.fn(async () => ({}) as Runbook)
    render(<RunbookForm projectId="proj-1" onSaved={vi.fn()} onCancel={vi.fn()} create={create} />)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'From the wiki' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'url' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://wiki.example.com/runbook' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('proj-1', {
        title: 'From the wiki',
        sourceKind: 'url',
        sourceRef: 'https://wiki.example.com/runbook',
      }),
    )
  })

  it('shows a file input when the upload source is selected', () => {
    render(<RunbookForm projectId="proj-1" onSaved={vi.fn()} onCancel={vi.fn()} create={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'upload' } })
    expect(screen.getByLabelText('File').getAttribute('type')).toBe('file')
  })

  it('calls onCancel without saving', () => {
    const onCancel = vi.fn()
    const create = vi.fn()
    render(<RunbookForm projectId="proj-1" onSaved={vi.fn()} onCancel={onCancel} create={create} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
