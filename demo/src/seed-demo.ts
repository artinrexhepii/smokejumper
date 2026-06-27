import { pathToFileURL } from 'node:url'
import {
  createDb,
  createPluginInstance,
  createSession,
  getPluginInstance,
  getSession,
  listProjects,
  verifyCredentials,
  type Db,
} from '@smokejumper/db'

// Fixed ids are a demo-only convention: the watchdog's ingest URL is knowable
// before the database exists, so nothing has to be copy-pasted.
export const DEMO_INSTANCE_IDS = {
  webhook: '00000000-0000-4000-8000-000000000001',
  docker: '00000000-0000-4000-8000-000000000002',
  http: '00000000-0000-4000-8000-000000000003',
} as const

const SEED_HINT = 'run the server seed first (docker compose runs it automatically; locally: pnpm --filter @smokejumper/server seed)'

export async function findDemoProject(db: Db): Promise<{ projectId: string }> {
  const user = await verifyCredentials(db, { email: 'admin@example.com', password: 'smokejumper' })
  if (!user) throw new Error(`demo admin user not found — ${SEED_HINT}`)
  const session = await createSession(db, user.id)
  const resolved = await getSession(db, session.token)
  if (!resolved) throw new Error(`could not resolve a session for the demo admin — ${SEED_HINT}`)
  for (const orgId of resolved.orgIds) {
    const projects = await listProjects(db, orgId)
    const demo = projects.find((p) => p.slug === 'demo')
    if (demo) return { projectId: demo.id }
  }
  throw new Error(`demo project not found — ${SEED_HINT}`)
}

export interface SeedDemoOptions {
  projectId: string
  encryptionKey: string
  dockerHost?: string
}

export async function seedDemoInstances(db: Db, opts: SeedDemoOptions): Promise<typeof DEMO_INSTANCE_IDS> {
  const dockerHost = opts.dockerHost ?? 'http://docker-proxy:2375'
  const wanted = [
    {
      id: DEMO_INSTANCE_IDS.webhook,
      pluginId: 'webhook',
      kind: 'alert-source',
      name: 'Demo watchdog webhook',
      config: {},
      credentials: { token: 'demo-token' },
    },
    {
      id: DEMO_INSTANCE_IDS.docker,
      pluginId: 'docker',
      kind: 'telemetry-source',
      name: 'Demo docker telemetry',
      config: { host: dockerHost },
      credentials: {},
    },
    {
      id: DEMO_INSTANCE_IDS.http,
      pluginId: 'http',
      kind: 'telemetry-source',
      name: 'Demo http checks',
      config: {},
      credentials: {},
    },
  ] as const

  for (const w of wanted) {
    const existing = await getPluginInstance(db, w.id)
    if (existing) continue
    await createPluginInstance(db, {
      id: w.id,
      projectId: opts.projectId,
      pluginId: w.pluginId,
      kind: w.kind,
      name: w.name,
      config: { ...w.config },
      credentials: { ...w.credentials },
      encryptionKey: opts.encryptionKey,
    })
  }
  return DEMO_INSTANCE_IDS
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const encryptionKey = process.env.SMOKEJUMPER_ENCRYPTION_KEY
  if (!encryptionKey) throw new Error('SMOKEJUMPER_ENCRYPTION_KEY is required')
  const db = createDb(process.env.DATABASE_URL ?? 'postgres://smokejumper:smokejumper@localhost:5432/smokejumper')
  const { projectId } = await findDemoProject(db)
  const instances = await seedDemoInstances(db, { projectId, encryptionKey })
  console.log(JSON.stringify({ projectId, instances }))
  // one-shot script: exit instead of tearing down the pg connection pool by hand
  process.exit(0)
}
