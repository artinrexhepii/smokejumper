// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewPanel } from '../src/components/ReviewPanel'
import { ApiError, type IncidentReview } from '../src/lib/api'

afterEach(cleanup)

function makeReview(overrides: Partial<IncidentReview> = {}): IncidentReview {
  return {
    id: 'rev-1',
    incidentId: 'inc-1',
    status: 'draft',
    generated: {
      summary: 'api was down for 12 minutes',
      timeline: [{ at: '10:15', text: 'api OOM-killed' }],
      rootCause: 'memory leak',
      contributingFactors: ['no alerting'],
      actionItems: ['add an alert'],
      evidenceRefs: ['ev-1'],
    },
    edited: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  }
}

describe('ReviewPanel', () => {
  it('shows a generate action when no review exists yet', async () => {
    const fetchReview = vi.fn(async () => {
      throw new ApiError(404, 'not found')
    })
    const generate = vi.fn(async () => makeReview())
    render(<ReviewPanel incidentId="inc-1" fetchReview={fetchReview} generate={generate} />)
    await waitFor(() => expect(screen.getByText(/no review has been generated/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /generate review/i }))
    await waitFor(() => expect(screen.getByText('api was down for 12 minutes')).toBeTruthy())
    expect(generate).toHaveBeenCalledWith('inc-1')
  })

  it('renders the generated review read-only with its timeline', async () => {
    const fetchReview = vi.fn(async () => makeReview())
    render(<ReviewPanel incidentId="inc-1" fetchReview={fetchReview} />)
    await waitFor(() => expect(screen.getByText('memory leak')).toBeTruthy())
    expect(screen.getByText(/api OOM-killed/)).toBeTruthy()
    expect(screen.getByText('draft')).toBeTruthy()
  })

  it('edits and saves the review', async () => {
    const fetchReview = vi.fn(async () => makeReview())
    const save = vi.fn(async () => makeReview({ edited: makeReview().generated }))
    render(<ReviewPanel incidentId="inc-1" fetchReview={fetchReview} save={save} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText(/action items/i), {
      target: { value: 'add an alert\nadd a runbook' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('inc-1', {
        summary: 'api was down for 12 minutes',
        timeline: [{ at: '10:15', text: 'api OOM-killed' }],
        rootCause: 'memory leak',
        contributingFactors: ['no alerting'],
        actionItems: ['add an alert', 'add a runbook'],
        evidenceRefs: ['ev-1'],
      }),
    )
  })

  it('approves the review and disables edit/approve afterwards', async () => {
    const fetchReview = vi.fn(async () => makeReview())
    const approve = vi.fn(async () => makeReview({ status: 'approved', approvedBy: 'u1' }))
    render(<ReviewPanel incidentId="inc-1" fetchReview={fetchReview} approve={approve} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith('inc-1'))
    await waitFor(() => expect(screen.getByText('approved')).toBeTruthy())
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('links the download action at the export route', async () => {
    const fetchReview = vi.fn(async () => makeReview())
    render(<ReviewPanel incidentId="inc-1" fetchReview={fetchReview} />)
    await waitFor(() => expect(screen.getByText(/download markdown/i)).toBeTruthy())
    const link = screen.getByText(/download markdown/i).closest('a')
    expect(link?.getAttribute('href')).toBe('http://localhost:3400/api/incidents/inc-1/review/export')
  })
})
