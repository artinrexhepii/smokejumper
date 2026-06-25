// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { VerdictControls } from '../src/components/VerdictControls'

afterEach(cleanup)

describe('VerdictControls', () => {
  it('optimistically shows the verdict and submits it', async () => {
    const submit = vi.fn(async () => {})
    render(<VerdictControls diagnosisId="diag-1" verdict={null} note={null} submit={submit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByText(/verdict: confirmed/i)).toBeTruthy()
    await waitFor(() => expect(submit).toHaveBeenCalledWith('diag-1', 'confirmed', undefined))
  })

  it('reverts and shows an error when submission fails', async () => {
    const submit = vi.fn(async () => {
      throw new Error('boom')
    })
    render(<VerdictControls diagnosisId="diag-1" verdict={null} note={null} submit={submit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Could not save verdict'),
    )
    expect(screen.queryByText(/verdict: rejected/i)).toBeNull()
  })

  it('sends the note with the verdict', async () => {
    const submit = vi.fn(async () => {})
    render(<VerdictControls diagnosisId="diag-1" verdict={null} note={null} submit={submit} />)
    fireEvent.change(screen.getByLabelText(/note/i), {
      target: { value: 'matched the postmortem' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Partially right' }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith('diag-1', 'partial', 'matched the postmortem'),
    )
  })
})
