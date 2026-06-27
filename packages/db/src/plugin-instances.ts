import { and, eq } from 'drizzle-orm'
import { decryptJson, encryptJson } from './crypto.ts'
import type { Db } from './db.ts'
import { pluginInstances, type PluginInstance } from './schema.ts'

export async function createPluginInstance(
  db: Db,
  input: {
    id?: string
    projectId: string
    pluginId: string
    kind: string
    name: string
    config: Record<string, unknown>
    credentials: Record<string, unknown>
    encryptionKey: string
  },
): Promise<PluginInstance> {
  const credentialsEncrypted =
    Object.keys(input.credentials).length > 0
      ? encryptJson(input.credentials, input.encryptionKey)
      : null
  const [instance] = await db
    .insert(pluginInstances)
    .values({
      id: input.id,
      projectId: input.projectId,
      pluginId: input.pluginId,
      kind: input.kind,
      name: input.name,
      config: input.config,
      credentialsEncrypted,
    })
    .returning()
  return instance!
}

export async function getPluginInstance(db: Db, id: string): Promise<PluginInstance | undefined> {
  const [instance] = await db.select().from(pluginInstances).where(eq(pluginInstances.id, id))
  return instance
}

export async function listPluginInstances(
  db: Db,
  projectId: string,
  kind?: string,
): Promise<PluginInstance[]> {
  return db
    .select()
    .from(pluginInstances)
    .where(
      and(
        eq(pluginInstances.projectId, projectId),
        kind === undefined ? undefined : eq(pluginInstances.kind, kind),
      ),
    )
}

export function getDecryptedConfig(
  instance: PluginInstance,
  encryptionKey: string,
): Record<string, unknown> {
  const credentials = instance.credentialsEncrypted
    ? (decryptJson(instance.credentialsEncrypted, encryptionKey) as Record<string, unknown>)
    : {}
  return { ...instance.config, ...credentials }
}
