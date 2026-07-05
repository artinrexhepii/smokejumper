import { z } from 'zod'
import type { SourceContext, TelemetrySource } from '@smokejumper/plugin-sdk'

export const githubDeploysConfigSchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'repo must be "owner/name"'),
})
export const githubDeploysCredentialSchema = z.object({ token: z.string().min(1) })

export type GithubDeploysConfig = z.infer<typeof githubDeploysConfigSchema> &
  z.infer<typeof githubDeploysCredentialSchema>

const API = 'https://api.github.com'

function githubGet(ctx: SourceContext<GithubDeploysConfig>, path: string): Promise<Response> {
  return ctx.fetch(`${API}${path}`, {
    signal: ctx.signal,
    headers: {
      authorization: `Bearer ${ctx.config.token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'smokejumper',
      'x-github-api-version': '2022-11-28',
    },
  })
}

export function createGithubDeploysTelemetrySource(): TelemetrySource<GithubDeploysConfig> {
  return {
    manifest: {
      id: 'github-deploys',
      name: 'GitHub Deploys',
      version: '0.1.0',
      sdkVersion: '0.2.0',
      kind: 'telemetry-source',
      description: 'Correlates incidents with recent GitHub deployments and commits',
      configSchema: githubDeploysConfigSchema,
      credentialSchema: githubDeploysCredentialSchema,
    },
    async healthCheck(ctx) {
      try {
        const res = await githubGet(ctx, `/repos/${ctx.config.repo}`)
        return res.ok
          ? { ok: true }
          : { ok: false, message: `github returned ${res.status} for ${ctx.config.repo}` }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    tools() {
      return [
        {
          name: 'list_recent_deploys',
          description: 'List the 10 most recent GitHub deployments for the configured repository',
          inputSchema: z.object({}),
          scope: 'read',
          costHint: 'cheap',
          latencyHintMs: 800,
          async execute(_input, ctx) {
            const res = await githubGet(ctx, `/repos/${ctx.config.repo}/deployments?per_page=10`)
            if (!res.ok) throw new Error(`github returned ${res.status}`)
            const deployments = (await res.json()) as Array<{
              id: number
              sha: string
              environment: string
              creator?: { login?: string } | null
              created_at: string
            }>
            const data = deployments.map((d) => ({
              id: d.id,
              sha: d.sha.slice(0, 7),
              environment: d.environment,
              creator: d.creator?.login ?? 'unknown',
              createdAt: d.created_at,
            }))
            return { summary: `${data.length} recent deployments of ${ctx.config.repo}`, data }
          },
        },
        {
          name: 'list_recent_commits',
          description: 'List the 15 most recent commits on the default branch of the configured repository',
          inputSchema: z.object({}),
          scope: 'read',
          costHint: 'cheap',
          latencyHintMs: 800,
          async execute(_input, ctx) {
            const res = await githubGet(ctx, `/repos/${ctx.config.repo}/commits?per_page=15`)
            if (!res.ok) throw new Error(`github returned ${res.status}`)
            const commits = (await res.json()) as Array<{
              sha: string
              commit: { message: string; author?: { name?: string; date?: string } | null }
              author?: { login?: string } | null
            }>
            const data = commits.map((c) => ({
              sha: c.sha.slice(0, 7),
              message: c.commit.message.split('\n')[0] ?? '',
              author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
              date: c.commit.author?.date ?? '',
            }))
            return { summary: `${data.length} recent commits on ${ctx.config.repo}`, data }
          },
        },
      ]
    },
  }
}
