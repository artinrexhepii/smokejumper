import { describe, expect, it } from 'vitest'
import { checkTelemetrySource, type SourceContext, type ToolContext } from '@smokejumper/plugin-sdk'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import {
  createGithubDeploysTelemetrySource,
  githubDeploysConfigSchema,
  type GithubDeploysConfig,
} from '../src/index'

const source = createGithubDeploysTelemetrySource()
const config: GithubDeploysConfig = { repo: 'acme/shop-api', token: 'ghp_test' }

const deployments = [
  {
    id: 7001,
    sha: 'a1b2c3d4e5f6a7b8',
    environment: 'production',
    creator: { login: 'artin' },
    created_at: '2026-07-04T08:30:00Z',
  },
  {
    id: 7000,
    sha: '9f8e7d6c5b4a3210',
    environment: 'staging',
    creator: null,
    created_at: '2026-07-03T16:00:00Z',
  },
]

const commits = [
  {
    sha: 'a1b2c3d4e5f6a7b8',
    commit: { message: 'tighten pool sizing\n\nlonger body here', author: { name: 'Artin', date: '2026-07-04T08:00:00Z' } },
    author: { login: 'artin' },
  },
]

function githubContext() {
  const seen: Array<{ url: string; headers: Record<string, string> }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const { pathname } = new URL(url)
    if (pathname === '/repos/acme/shop-api') return Response.json({ full_name: 'acme/shop-api' })
    if (pathname === '/repos/acme/shop-api/deployments') return Response.json(deployments)
    if (pathname === '/repos/acme/shop-api/commits') return Response.json(commits)
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  const base: SourceContext<GithubDeploysConfig> = { ...createTestContext(config), fetch: fetchImpl }
  const ctx: ToolContext<GithubDeploysConfig> = { ...base, incidentId: 'inc-1' }
  return { base, ctx, seen }
}

const tool = (name: string) => source.tools().find((t) => t.name === name)!

describe('github deploys telemetry source', () => {
  it('passes conformance', async () => {
    const { base } = githubContext()
    const result = await checkTelemetrySource(source, base)
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('lists recent deployments with short shas and auth headers', async () => {
    const { ctx, seen } = githubContext()
    const t = tool('list_recent_deploys')
    const result = await t.execute(t.inputSchema.parse({}), ctx)
    expect(result.data).toEqual([
      { id: 7001, sha: 'a1b2c3d', environment: 'production', creator: 'artin', createdAt: '2026-07-04T08:30:00Z' },
      { id: 7000, sha: '9f8e7d6', environment: 'staging', creator: 'unknown', createdAt: '2026-07-03T16:00:00Z' },
    ])
    expect(seen[0]!.url).toBe('https://api.github.com/repos/acme/shop-api/deployments?per_page=10')
    expect(seen[0]!.headers.authorization).toBe('Bearer ghp_test')
    expect(seen[0]!.headers.accept).toBe('application/vnd.github+json')
  })

  it('lists recent commits with first-line messages', async () => {
    const { ctx } = githubContext()
    const t = tool('list_recent_commits')
    const result = await t.execute(t.inputSchema.parse({}), ctx)
    expect(result.data).toEqual([
      { sha: 'a1b2c3d', message: 'tighten pool sizing', author: 'Artin', date: '2026-07-04T08:00:00Z' },
    ])
  })

  it('reports an unhealthy repo through healthCheck', async () => {
    const failing = (async () => new Response('bad credentials', { status: 401 })) as typeof fetch
    const health = await source.healthCheck({ ...createTestContext(config), fetch: failing })
    expect(health.ok).toBe(false)
    expect(health.message).toContain('401')
  })

  it('rejects a repo that is not owner/name', () => {
    expect(githubDeploysConfigSchema.safeParse({ repo: 'nope', token: 't' }).success).toBe(false)
    expect(githubDeploysConfigSchema.safeParse({ repo: 'acme/shop-api', token: 't' }).success).toBe(true)
  })
})
