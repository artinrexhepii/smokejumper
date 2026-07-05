import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  checkInstanceHealth,
  createInstance,
  deleteInstance,
  getIncident,
  listIncidents,
  listInstances,
  listPlugins,
  listProjects,
  login,
  logout,
  me,
  submitVerdict,
  updateInstance,
} from '../src/lib/api'

function stubFetch(status: number, body?: unknown) {
  const impl = vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  it('sends credentials and a json body on login', async () => {
    const impl = stubFetch(200, { user: { id: 'u1', email: 'a@example.com', name: 'A' } })
    const result = await login('a@example.com', 'pw')
    expect(result.user.id).toBe('u1')
    const [url, init] = impl.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:3400/api/auth/login')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@example.com', password: 'pw' })
  })

  it('maps error responses to ApiError with the server message', async () => {
    stubFetch(401, { message: 'invalid credentials' })
    const err = await me().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
    expect((err as ApiError).message).toBe('invalid credentials')
  })

  it('falls back to a status message for non-json error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const err = await listProjects('org-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toBe('request failed with status 500')
  })

  it('resolves void for 204 responses and sends the verdict body', async () => {
    const impl = stubFetch(204)
    await expect(submitVerdict('diag-1', 'confirmed', 'good catch')).resolves.toBeUndefined()
    const [url, init] = impl.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:3400/api/diagnoses/diag-1/verdict')
    expect(JSON.parse(init.body as string)).toEqual({ verdict: 'confirmed', note: 'good catch' })
  })

  it('omits the note when not provided', async () => {
    const impl = stubFetch(204)
    await submitVerdict('diag-1', 'rejected')
    const [, init] = impl.mock.calls[0]! as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ verdict: 'rejected' })
  })

  it('performs GETs without a content-type header', async () => {
    const impl = stubFetch(200, [])
    await listIncidents('proj-1')
    const [url, init] = impl.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:3400/api/projects/proj-1/incidents')
    expect(new Headers(init.headers).get('content-type')).toBeNull()
  })

  it('fetches incident detail by id', async () => {
    const impl = stubFetch(200, { incident: { id: 'inc-1' }, findings: [], evidence: [] })
    const detail = await getIncident('inc-1')
    const [url] = impl.mock.calls[0]! as unknown as [string]
    expect(url).toBe('http://localhost:3400/api/incidents/inc-1')
    expect(detail.findings).toEqual([])
  })

  it('tolerates an empty logout response body', async () => {
    stubFetch(204)
    await expect(logout()).resolves.toBeUndefined()
  })

  it('lists available plugins with their descriptors', async () => {
    const impl = stubFetch(200, [
      {
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
      },
    ])
    const plugins = await listPlugins()
    expect((impl.mock.calls[0]! as unknown as [string, RequestInit])[0]).toBe('http://localhost:3400/api/plugins')
    expect(plugins[0]!.manifest.id).toBe('slack')
    expect(plugins[0]!.descriptor.credentials[0]!.secret).toBe(true)
  })

  it('lists plugin instances for a project', async () => {
    const impl = stubFetch(200, [])
    await listInstances('proj-1')
    expect((impl.mock.calls[0]! as unknown as [string, RequestInit])[0]).toBe('http://localhost:3400/api/projects/proj-1/instances')
  })

  it('creates a plugin instance with the split config and credentials', async () => {
    const impl = stubFetch(201, { id: 'inst-1' })
    await createInstance('proj-1', {
      pluginId: 'slack',
      name: 'Team alerts',
      config: { channel: '#incidents' },
      credentials: { botToken: 'xoxb-secret' },
    })
    const [url, init] = impl.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:3400/api/projects/proj-1/instances')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      pluginId: 'slack',
      name: 'Team alerts',
      config: { channel: '#incidents' },
      credentials: { botToken: 'xoxb-secret' },
    })
  })

  it('updates a plugin instance', async () => {
    const impl = stubFetch(200, { id: 'inst-1', enabled: false })
    await updateInstance('inst-1', { enabled: false })
    const [url, init] = impl.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:3400/api/instances/inst-1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ enabled: false })
  })

  it('deletes a plugin instance', async () => {
    const impl = stubFetch(204)
    await expect(deleteInstance('inst-1')).resolves.toBeUndefined()
    const [url, init] = impl.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:3400/api/instances/inst-1')
    expect(init.method).toBe('DELETE')
  })

  it('checks instance health', async () => {
    const impl = stubFetch(200, { ok: true })
    const result = await checkInstanceHealth('inst-1')
    const [url, init] = impl.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:3400/api/instances/inst-1/health')
    expect(init.method).toBe('POST')
    expect(result).toEqual({ ok: true })
  })

  it('resolves session info including each org role', async () => {
    stubFetch(200, {
      user: { id: 'u1', email: 'a@example.com', name: 'A' },
      orgs: [{ id: 'o1', name: 'Acme', slug: 'acme', role: 'owner' }],
    })
    const session = await me()
    expect(session.orgs[0]!.role).toBe('owner')
  })
})
