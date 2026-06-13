import { createDb, runMigrations } from '@smokejumper/db'
import { createBuiltinRegistry, startNotificationDispatcher } from '@smokejumper/plugin-host'
import { createBus } from './bus.ts'
import { buildServer } from './server.ts'

const encryptionKey = process.env.SMOKEJUMPER_ENCRYPTION_KEY
if (!encryptionKey) {
  console.error('SMOKEJUMPER_ENCRYPTION_KEY is required (base64-encoded 32 bytes)')
  process.exit(1)
}

const url = process.env.DATABASE_URL ?? 'postgres://smokejumper:smokejumper@localhost:5432/smokejumper'
const db = createDb(url)
await runMigrations(db)

const bus = createBus()
const registry = createBuiltinRegistry()
startNotificationDispatcher({ db, encryptionKey, registry, bus })
const app = await buildServer({ db, encryptionKey, bus, registry })
await app.listen({ port: Number(process.env.PORT ?? 3400), host: '0.0.0.0' })
