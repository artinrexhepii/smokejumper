import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  addMember,
  createOrganization,
  createProject,
  createSession,
  createTestDb,
  createUser,
  getRunbook,
  listAudit,
  searchRunbookChunks,
  type Db,
} from '@smokejumper/db'
import type { FastifyInstance } from 'fastify'
import { buildServer, createBus } from '../src/index.ts'

const KEY = Buffer.alloc(32, 7).toString('base64')
const embedder = async () => new Array<number>(1536).fill(0.5)

interface Ctx {
  db: Db
  app: FastifyInstance
  orgId: string
  projectId: string
  member: { sj_session: string }
  outsider: { sj_session: string }
}

async function setup(fetchImpl?: typeof fetch): Promise<Ctx> {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const otherOrg = await createOrganization(db, { name: 'Other', slug: 'other' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  const memberUser = await createUser(db, { email: 'member@example.com', password: 'smokejumper', name: 'Member' })
  const outsiderUser = await createUser(db, {
    email: 'outsider@example.com',
    password: 'smokejumper',
    name: 'Outsider',
  })
  await addMember(db, { orgId: org.id, userId: memberUser.id, role: 'member' })
  await addMember(db, { orgId: otherOrg.id, userId: outsiderUser.id, role: 'member' })
  const app = await buildServer({ db, encryptionKey: KEY, bus: createBus(), embedder, fetchImpl })
  return {
    db,
    app,
    orgId: org.id,
    projectId: project.id,
    member: { sj_session: (await createSession(db, memberUser.id)).token },
    outsider: { sj_session: (await createSession(db, outsiderUser.id)).token },
  }
}

describe('runbook routes', () => {
  it('creates a pasted runbook, embeds it, and audits the creation', async () => {
    const ctx = await setup()
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${ctx.projectId}/runbooks`,
      cookies: ctx.member,
      payload: {
        title: 'Restart guide',
        sourceKind: 'paste',
        content: 'Step 1. Restart the pods.\n\nStep 2. Check the logs.',
      },
    })
    expect(res.statusCode).toBe(201)
    const runbook = res.json()
    expect(runbook.title).toBe('Restart guide')
    expect(runbook.chunkCount).toBeGreaterThan(0)

    const chunks = await searchRunbookChunks(ctx.db, { projectId: ctx.projectId, embedding: await embedder() })
    expect(chunks.length).toBe(runbook.chunkCount)

    const audit = await listAudit(ctx.db, { orgId: ctx.orgId })
    expect(audit[0]).toMatchObject({ action: 'runbook.create', subjectType: 'runbook', subjectId: runbook.id })
  })

  it('fetches url runbooks once, server-side, via the injected fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response('# Runbook\n\nDo the thing.', { status: 200 }))
    const ctx = await setup(fetchImpl as unknown as typeof fetch)
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${ctx.projectId}/runbooks`,
      cookies: ctx.member,
      payload: { title: 'From the wiki', sourceKind: 'url', sourceRef: 'https://wiki.example.com/runbook' },
    })
    expect(res.statusCode).toBe(201)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('https://wiki.example.com/runbook')
    expect(res.json().content).toBe('# Runbook\n\nDo the thing.')
  })

  it('rejects a url runbook when the fetch responds with an error status', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }))
    const ctx = await setup(fetchImpl as unknown as typeof fetch)
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${ctx.projectId}/runbooks`,
      cookies: ctx.member,
      payload: { title: 'Broken', sourceKind: 'url', sourceRef: 'https://wiki.example.com/missing' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a paste runbook with no content and a url runbook with no sourceRef', async () => {
    const ctx = await setup()
    const noContent = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${ctx.projectId}/runbooks`,
      cookies: ctx.member,
      payload: { title: 'Empty', sourceKind: 'paste' },
    })
    expect(noContent.statusCode).toBe(400)
    const noRef = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${ctx.projectId}/runbooks`,
      cookies: ctx.member,
      payload: { title: 'No ref', sourceKind: 'url' },
    })
    expect(noRef.statusCode).toBe(400)
  })

  it('lists and deletes runbooks, removing their chunks and auditing the deletion', async () => {
    const ctx = await setup()
    const created = (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/projects/${ctx.projectId}/runbooks`,
        cookies: ctx.member,
        payload: { title: 'R', sourceKind: 'paste', content: 'content here' },
      })
    ).json()

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${ctx.projectId}/runbooks`,
      cookies: ctx.member,
    })
    expect(list.json().map((r: { id: string }) => r.id)).toEqual([created.id])

    const del = await ctx.app.inject({ method: 'DELETE', url: `/api/runbooks/${created.id}`, cookies: ctx.member })
    expect(del.statusCode).toBe(204)
    expect(await getRunbook(ctx.db, created.id)).toBeUndefined()
    const chunks = await searchRunbookChunks(ctx.db, { projectId: ctx.projectId, embedding: await embedder() })
    expect(chunks).toHaveLength(0)

    const audit = await listAudit(ctx.db, { orgId: ctx.orgId })
    expect(audit[0]).toMatchObject({ action: 'runbook.delete', subjectId: created.id })
  })

  it('forbids org outsiders from reading, listing, or deleting runbooks', async () => {
    const ctx = await setup()
    const created = (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/projects/${ctx.projectId}/runbooks`,
        cookies: ctx.member,
        payload: { title: 'R', sourceKind: 'paste', content: 'content here' },
      })
    ).json()

    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/projects/${ctx.projectId}/runbooks`,
          cookies: ctx.outsider,
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (await ctx.app.inject({ method: 'GET', url: `/api/runbooks/${created.id}`, cookies: ctx.outsider }))
        .statusCode,
    ).toBe(403)
    expect(
      (await ctx.app.inject({ method: 'DELETE', url: `/api/runbooks/${created.id}`, cookies: ctx.outsider }))
        .statusCode,
    ).toBe(403)
  })

  it('404s unknown runbooks and projects', async () => {
    const ctx = await setup()
    expect(
      (await ctx.app.inject({ method: 'GET', url: `/api/runbooks/${randomUUID()}`, cookies: ctx.member }))
        .statusCode,
    ).toBe(404)
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/projects/${randomUUID()}/runbooks`,
          cookies: ctx.member,
        })
      ).statusCode,
    ).toBe(404)
  })

  it('leaves the chunk count at 0 when no embedder is configured', async () => {
    const db = await createTestDb()
    const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
    const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
    const user = await createUser(db, { email: 'm@example.com', password: 'smokejumper', name: 'M' })
    await addMember(db, { orgId: org.id, userId: user.id, role: 'member' })
    const app = await buildServer({ db, encryptionKey: KEY, bus: createBus() })
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/runbooks`,
      cookies: { sj_session: (await createSession(db, user.id)).token },
      payload: { title: 'No embedder', sourceKind: 'paste', content: 'content' },
    })
    expect(res.json().chunkCount).toBe(0)
  })
})
