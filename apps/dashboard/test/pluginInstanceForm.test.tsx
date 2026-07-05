// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PluginInstanceForm } from '../src/components/PluginInstanceForm'
import type { PluginInstanceView, PluginManifestInfo } from '../src/lib/api'

afterEach(cleanup)

const slackPlugin: PluginManifestInfo = {
  manifest: {
    id: 'slack',
    name: 'Slack',
    version: '1.0.0',
    kind: 'notification-sink',
    description: 'Posts notifications to Slack',
    sdkVersion: '0.2.0',
  },
  descriptor: {
    config: [{ key: 'channel', type: 'string', required: true, secret: false }],
    credentials: [{ key: 'botToken', type: 'string', required: true, secret: true }],
  },
}

const cloudwatchPlugin: PluginManifestInfo = {
  manifest: {
    id: 'cloudwatch',
    name: 'CloudWatch',
    version: '1.0.0',
    kind: 'telemetry-source',
    description: 'AWS CloudWatch metrics and logs',
    sdkVersion: '0.2.0',
  },
  descriptor: {
    config: [
      { key: 'region', type: 'string', required: true, secret: false },
      { key: 'periodSeconds', type: 'number', required: false, secret: false, default: 300 },
      { key: 'verbose', type: 'boolean', required: false, secret: false, default: false },
      {
        key: 'stat',
        type: 'enum',
        required: false,
        secret: false,
        enumValues: ['Average', 'Sum', 'Maximum'],
      },
    ],
    credentials: [],
  },
}

const existingInstance: PluginInstanceView = {
  id: 'inst-1',
  projectId: 'proj-1',
  pluginId: 'slack',
  kind: 'notification-sink',
  name: 'Team alerts',
  enabled: true,
  config: { channel: '#incidents' },
  credentials: { botToken: 'set' },
  createdAt: '2026-07-05T00:00:00.000Z',
}

describe('PluginInstanceForm', () => {
  it('renders a text, number, checkbox, and select input for each config field type', () => {
    render(
      <PluginInstanceForm
        projectId="proj-1"
        pluginInfo={cloudwatchPlugin}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        create={vi.fn(async () => ({}) as PluginInstanceView)}
      />,
    )
    expect(screen.getByLabelText(/^region/i).getAttribute('type')).toBe('text')
    expect(screen.getByLabelText(/periodseconds/i).getAttribute('type')).toBe('number')
    expect(screen.getByLabelText(/verbose/i).getAttribute('type')).toBe('checkbox')
    expect(screen.getByLabelText(/^stat/i).tagName).toBe('SELECT')
  })

  it('creates a new instance from typed field values', async () => {
    const create = vi.fn(async () => ({}) as PluginInstanceView)
    render(
      <PluginInstanceForm
        projectId="proj-1"
        pluginInfo={slackPlugin}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        create={create}
      />,
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Team alerts' } })
    fireEvent.change(screen.getByLabelText(/channel/i), { target: { value: '#incidents' } })
    fireEvent.change(screen.getByLabelText(/bottoken/i), { target: { value: 'xoxb-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('proj-1', {
        pluginId: 'slack',
        name: 'Team alerts',
        config: { channel: '#incidents' },
        credentials: { botToken: 'xoxb-secret' },
      }),
    )
  })

  it('shows a set hint for a present secret and omits credentials from the update when left blank', async () => {
    const update = vi.fn(async () => ({}) as PluginInstanceView)
    render(
      <PluginInstanceForm
        projectId="proj-1"
        pluginInfo={slackPlugin}
        initialInstance={existingInstance}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        update={update}
      />,
    )
    expect(screen.getByText(/set — leave blank/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('inst-1', {
        name: 'Team alerts',
        config: { channel: '#incidents' },
      }),
    )
  })

  it('includes a typed secret replacement in the update body', async () => {
    const update = vi.fn(async () => ({}) as PluginInstanceView)
    render(
      <PluginInstanceForm
        projectId="proj-1"
        pluginInfo={slackPlugin}
        initialInstance={existingInstance}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        update={update}
      />,
    )
    fireEvent.change(screen.getByLabelText(/bottoken/i), { target: { value: 'xoxb-new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('inst-1', {
        name: 'Team alerts',
        config: { channel: '#incidents' },
        credentials: { botToken: 'xoxb-new' },
      }),
    )
  })
})
