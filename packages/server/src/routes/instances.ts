import {
  appendAudit,
  createPluginInstance,
  decryptJson,
  deletePluginInstance,
  getMemberRole,
  getPluginInstance,
  getProject,
  listPluginInstances,
  updatePluginInstance,
  type Db,
  type PluginInstance,
} from '@smokejumper/db'
import { PluginConfigError, validateInstanceInput, type PluginRegistry } from '@smokejumper/plugin-host'
import { describeConfig, type PluginKind, type PluginManifest } from '@smokejumper/plugin-sdk'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

export interface PluginRoutesDeps {
  db: Db
  encryptionKey: string
  registry: PluginRegistry
}

export interface PluginInstanceView {
  id: string
  projectId: string
  pluginId: string
  kind: PluginKind
  name: string
  enabled: boolean
  config: Record<string, unknown>
  credentials: Record<string, 'set' | 'unset'>
  createdAt: string
  ingestUrl?: string
}

const createBody = z.object({
  pluginId: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.unknown()).default({}),
  credentials: z.record(z.unknown()).default({}),
})

const patchBody = z.object({
  name: z.string().min(1).optional(),
  config: z.record(z.unknown()).optional(),
  credentials: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
})

function publicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? 'http://localhost:3400'
}

function credentialPresence(
  instance: PluginInstance,
  encryptionKey: string,
  credentialKeys: string[],
): Record<string, 'set' | 'unset'> {
  const decrypted = instance.credentialsEncrypted
    ? (decryptJson(instance.credentialsEncrypted, encryptionKey) as Record<string, unknown>)
    : {}
  const presence: Record<string, 'set' | 'unset'> = {}
  for (const key of credentialKeys) {
    const value = decrypted[key]
    presence[key] = value !== undefined && value !== null && value !== '' ? 'set' : 'unset'
  }
  return presence
}

function toInstanceView(
  instance: PluginInstance,
  manifest: PluginManifest,
  encryptionKey: string,
): PluginInstanceView {
  const credentialKeys = describeConfig(manifest).credentials.map((field) => field.key)
  const view: PluginInstanceView = {
    id: instance.id,
    projectId: instance.projectId,
    pluginId: instance.pluginId,
    kind: manifest.kind,
    name: instance.name,
    enabled: instance.enabled,
    config: instance.config,
    credentials: credentialPresence(instance, encryptionKey, credentialKeys),
    createdAt: instance.createdAt.toISOString(),
  }
  if (manifest.kind === 'alert-source') {
    view.ingestUrl = `${publicBaseUrl()}/ingest/${instance.id}`
  }
  return view
}

export function registerInstanceRoutes(app: FastifyInstance, deps: PluginRoutesDeps): void {
  function manifestFor(pluginId: string): PluginManifest | undefined {
    return deps.registry.manifests().find((m) => m.id === pluginId)
  }

  async function ownerOrAdmin(request: FastifyRequest, orgId: string): Promise<boolean> {
    const role = await getMemberRole(deps.db, { orgId, userId: request.auth!.user.id })
    return role === 'owner' || role === 'admin'
  }

  app.get('/api/projects/:projectId/instances', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await getProject(deps.db, projectId)
    if (!project) return reply.code(404).send({ error: 'not found' })
    if (!(await ownerOrAdmin(request, project.orgId))) return reply.code(403).send({ error: 'forbidden' })
    const instances = await listPluginInstances(deps.db, projectId)
    const views: PluginInstanceView[] = []
    for (const instance of instances) {
      const manifest = manifestFor(instance.pluginId)
      if (!manifest) continue
      views.push(toInstanceView(instance, manifest, deps.encryptionKey))
    }
    return views
  })

  app.post('/api/projects/:projectId/instances', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await getProject(deps.db, projectId)
    if (!project) return reply.code(404).send({ error: 'not found' })
    if (!(await ownerOrAdmin(request, project.orgId))) return reply.code(403).send({ error: 'forbidden' })
    const parsed = createBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })
    const manifest = manifestFor(parsed.data.pluginId)
    if (!manifest) return reply.code(400).send({ error: 'unknown plugin' })
    let validated: { config: Record<string, unknown>; credentials: Record<string, unknown> }
    try {
      validated = validateInstanceInput({
        manifest,
        config: parsed.data.config,
        credentials: parsed.data.credentials,
      })
    } catch (err) {
      if (err instanceof PluginConfigError) return reply.code(400).send({ error: err.message })
      throw err
    }
    const instance = await createPluginInstance(deps.db, {
      projectId,
      pluginId: manifest.id,
      kind: manifest.kind,
      name: parsed.data.name,
      config: validated.config,
      credentials: validated.credentials,
      encryptionKey: deps.encryptionKey,
    })
    await appendAudit(deps.db, {
      orgId: project.orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'plugin.instance.created',
      subjectType: 'plugin_instance',
      subjectId: instance.id,
      detail: { pluginId: manifest.id, name: instance.name },
    })
    return reply.code(201).send(toInstanceView(instance, manifest, deps.encryptionKey))
  })

  app.get('/api/instances/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const instance = await getPluginInstance(deps.db, id)
    if (!instance) return reply.code(404).send({ error: 'not found' })
    const project = await getProject(deps.db, instance.projectId)
    if (!project || !(await ownerOrAdmin(request, project.orgId))) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    const manifest = manifestFor(instance.pluginId)
    if (!manifest) return reply.code(404).send({ error: 'not found' })
    return toInstanceView(instance, manifest, deps.encryptionKey)
  })

  app.patch('/api/instances/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const instance = await getPluginInstance(deps.db, id)
    if (!instance) return reply.code(404).send({ error: 'not found' })
    const project = await getProject(deps.db, instance.projectId)
    if (!project || !(await ownerOrAdmin(request, project.orgId))) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    const manifest = manifestFor(instance.pluginId)
    if (!manifest) return reply.code(404).send({ error: 'not found' })
    const parsed = patchBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })

    let config: Record<string, unknown> | undefined
    if (parsed.data.config !== undefined) {
      const result = manifest.configSchema.safeParse(parsed.data.config)
      if (!result.success) return reply.code(400).send({ error: 'invalid config' })
      config = result.data as Record<string, unknown>
    }
    let credentials: Record<string, unknown> | undefined
    if (parsed.data.credentials !== undefined) {
      if (manifest.credentialSchema) {
        const result = manifest.credentialSchema.safeParse(parsed.data.credentials)
        if (!result.success) return reply.code(400).send({ error: 'invalid credentials' })
        credentials = result.data as Record<string, unknown>
      } else {
        credentials = {}
      }
    }

    const updated = await updatePluginInstance(deps.db, id, {
      name: parsed.data.name,
      enabled: parsed.data.enabled,
      config,
      credentials,
      encryptionKey: deps.encryptionKey,
    })
    await appendAudit(deps.db, {
      orgId: project.orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'plugin.instance.updated',
      subjectType: 'plugin_instance',
      subjectId: id,
      detail: { pluginId: manifest.id },
    })
    return toInstanceView(updated, manifest, deps.encryptionKey)
  })

  app.delete('/api/instances/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const instance = await getPluginInstance(deps.db, id)
    if (!instance) return reply.code(404).send({ error: 'not found' })
    const project = await getProject(deps.db, instance.projectId)
    if (!project || !(await ownerOrAdmin(request, project.orgId))) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    await deletePluginInstance(deps.db, id)
    await appendAudit(deps.db, {
      orgId: project.orgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'plugin.instance.deleted',
      subjectType: 'plugin_instance',
      subjectId: id,
      detail: { pluginId: instance.pluginId },
    })
    return reply.code(204).send()
  })
}
