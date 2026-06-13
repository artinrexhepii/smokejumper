import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  createOrganization,
  createPluginInstance,
  createProject,
  createTestDb,
  listIncidents,
} from '@smokejumper/db'
import { createBuiltinRegistry } from '@smokejumper/plugin-host'
import type { IncidentEvent } from '@smokejumper/plugin-sdk'
import { buildServer, createBus } from '../src/index'

const encryptionKey = Buffer.alloc(32, 1).toString('base64')

type App = Awaited<ReturnType<typeof buildServer>>

const alertPayload = {
  title: 'shop-api: error rate spike',
  severity: 'high',
  service: 'shop-api',
  dedupKey: 'shop-api-errors',
}

async function setup() {
  const db = await createTestDb()
  const bus = createBus()
  const registry = createBuiltinRegistry()
  const app = await buildServer({ db, encryptionKey, bus, registry })
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  const instance = await createPluginInstance(db, {
    projectId: project.id,
    pluginId: 'webhook',
    kind: 'alert-source',
    name: 'Generic webhook',
    config: {},
    credentials: { token: 'demo-token' },
    encryptionKey,
  })
  return { db, bus, app, project, instance }
}

function post(app: App, instanceId: string, body: unknown, token = 'demo-token') {
  return app.inject({
    method: 'POST',
    url: `/ingest/${instanceId}`,
    headers: { 'content-type': 'application/json', 'x-smokejumper-token': token },
    payload: JSON.stringify(body),
  })
}

describe('POST /ingest/:instanceId', () => {
  it('accepts a verified webhook alert and opens an incident', async () => {
    const { db, bus, app, project, instance } = await setup()
    const events: IncidentEvent[] = []
    bus.subscribe((event) => events.push(event))
    const res = await post(app, instance.id, alertPayload)
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: 1 })
    const incidents = await listIncidents(db, project.id)
    expect(incidents).toHaveLength(1)
    expect(incidents[0]!.status).toBe('open')
    expect(events.map((event) => event.type)).toEqual(['incident.opened'])
  })

  it('dedups a repeated alert into the same incident', async () => {
    const { db, app, project, instance } = await setup()
    await post(app, instance.id, alertPayload)
    const res = await post(app, instance.id, alertPayload)
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: 1 })
    const incidents = await listIncidents(db, project.id)
    expect(incidents).toHaveLength(1)
  })

  it('rejects a bad token with 401', async () => {
    const { db, app, project, instance } = await setup()
    const res = await post(app, instance.id, alertPayload, 'wrong-token')
    expect(res.statusCode).toBe(401)
    expect(await listIncidents(db, project.id)).toHaveLength(0)
  })

  it('returns 404 for an unknown instance', async () => {
    const { app } = await setup()
    const res = await post(app, randomUUID(), alertPayload)
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 for an instance that is not an alert source', async () => {
    const { db, app, project } = await setup()
    const docker = await createPluginInstance(db, {
      projectId: project.id,
      pluginId: 'docker',
      kind: 'telemetry-source',
      name: 'Docker',
      config: { host: 'http://docker-proxy:2375' },
      credentials: {},
      encryptionKey,
    })
    const res = await post(app, docker.id, alertPayload)
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 for a disabled instance', async () => {
    const { db, app, instance } = await setup()
    await db.execute(sql`update plugin_instances set enabled = false where id = ${instance.id}`)
    const res = await post(app, instance.id, alertPayload)
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for a payload that fails normalization', async () => {
    const { app, instance } = await setup()
    const res = await post(app, instance.id, { nonsense: true })
    expect(res.statusCode).toBe(400)
  })
})
