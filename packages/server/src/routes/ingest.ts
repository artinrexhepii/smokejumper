import type { FastifyInstance } from 'fastify'
import type { Db } from '@smokejumper/db'
import type { NormalizedAlert } from '@smokejumper/plugin-sdk'
import {
  InstanceNotFoundError,
  PluginConfigError,
  resolveInstance,
  UnknownPluginError,
  type PluginRegistry,
} from '@smokejumper/plugin-host'

export interface IngestDeps {
  db: Db
  encryptionKey: string
  registry: PluginRegistry
  incidentManager: {
    ingest(projectId: string, alerts: NormalizedAlert[]): Promise<Array<{ incident: unknown; isNew: boolean }>>
  }
}

export async function registerIngestRoutes(app: FastifyInstance, deps: IngestDeps): Promise<void> {
  await app.register(async (scope) => {
    // alert sources verify signatures over the exact bytes, so keep the raw body
    scope.removeContentTypeParser('application/json')
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      done(null, body)
    })

    scope.post('/ingest/:instanceId', async (req, reply) => {
      const { instanceId } = req.params as { instanceId: string }

      let instance
      let config: unknown
      try {
        ;({ instance, config } = await resolveInstance({
          db: deps.db,
          encryptionKey: deps.encryptionKey,
          registry: deps.registry,
          instanceId,
        }))
      } catch (err) {
        if (err instanceof InstanceNotFoundError || err instanceof UnknownPluginError) {
          return reply.code(404).send({ error: 'not found' })
        }
        if (err instanceof PluginConfigError) {
          return reply.code(500).send({ error: 'plugin config invalid' })
        }
        throw err
      }

      if (instance.kind !== 'alert-source' || !instance.enabled) {
        return reply.code(404).send({ error: 'not found' })
      }
      const source = deps.registry.alertSource(instance.pluginId)
      if (!source) {
        return reply.code(404).send({ error: 'not found' })
      }

      const rawBody = typeof req.body === 'string' ? req.body : ''
      let body: unknown
      try {
        body = rawBody === '' ? undefined : JSON.parse(rawBody)
      } catch {
        return reply.code(400).send({ error: 'invalid json' })
      }

      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers[key.toLowerCase()] = value
        else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(', ')
      }

      if (!(await source.verify({ headers, body, rawBody }, config))) {
        return reply.code(401).send({ error: 'verification failed' })
      }

      let alerts: NormalizedAlert[]
      try {
        const normalized = source.normalize(body, config)
        alerts = Array.isArray(normalized) ? normalized : [normalized]
      } catch {
        return reply.code(400).send({ error: 'payload not recognized' })
      }

      const results = await deps.incidentManager.ingest(instance.projectId, alerts)
      return reply.code(202).send({ accepted: results.length })
    })
  })
}
