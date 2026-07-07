import { appendAudit, getMemberRole, type Db } from '@smokejumper/db'
import { installBundle, listInstalledBundles, loadRegistryIndex, resolveVersion, type TrustKey } from '@smokejumper/registry'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

export interface RegistryRoutesDeps {
  db: Db
  pluginsDir: string
  bundledIndexPath: string
  registryUrl?: string
  trustKeys: TrustKey[]
  autoUpdate: boolean
  fetchImpl?: typeof fetch
}

const installBody = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
})

// Registry install is server-global, not project-scoped (contracts §F.7), so
// authorization walks the actor's orgs for the first one where they are
// owner/admin, rather than a project → org chain.
async function findManageableOrgId(db: Db, request: FastifyRequest): Promise<string | undefined> {
  for (const orgId of request.auth!.orgIds) {
    const role = await getMemberRole(db, { orgId, userId: request.auth!.user.id })
    if (role === 'owner' || role === 'admin') return orgId
  }
  return undefined
}

export function registerRegistryRoutes(app: FastifyInstance, deps: RegistryRoutesDeps): void {
  app.get('/api/registry', async (_request, reply) => {
    try {
      const index = await loadRegistryIndex({
        bundledPath: deps.bundledIndexPath,
        url: deps.registryUrl,
        trustKeys: deps.trustKeys,
        fetchImpl: deps.fetchImpl,
      })
      const installed = await listInstalledBundles(deps.pluginsDir)
      return { index, installed }
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'registry index unavailable' })
    }
  })

  app.get('/api/registry/policy', async () => {
    return { autoUpdate: deps.autoUpdate }
  })

  app.post('/api/registry/install', async (request, reply) => {
    const manageableOrgId = await findManageableOrgId(deps.db, request)
    if (!manageableOrgId) return reply.code(403).send({ error: 'forbidden' })

    const parsed = installBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' })

    let index
    try {
      index = await loadRegistryIndex({
        bundledPath: deps.bundledIndexPath,
        url: deps.registryUrl,
        trustKeys: deps.trustKeys,
        fetchImpl: deps.fetchImpl,
      })
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'registry index unavailable' })
    }
    const entry = index.entries.find((e) => e.id === parsed.data.id)
    if (!entry) return reply.code(404).send({ error: 'unknown plugin' })
    const versionEntry = resolveVersion(entry, parsed.data.version)
    if (!versionEntry) return reply.code(404).send({ error: 'unknown version' })

    try {
      await installBundle({
        entry,
        version: parsed.data.version,
        dir: deps.pluginsDir,
        trustKeys: deps.trustKeys,
        fetchImpl: deps.fetchImpl,
      })
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'install failed' })
    }

    await appendAudit(deps.db, {
      orgId: manageableOrgId,
      actorType: 'user',
      actorId: request.auth!.user.id,
      action: 'plugin.install',
      subjectType: 'registry_entry',
      subjectId: `${parsed.data.id}@${parsed.data.version}`,
      detail: { pluginId: parsed.data.id, version: parsed.data.version },
    })

    return reply.code(202).send({ restartRequired: true })
  })
}
