import { createDb, runMigrations } from '@smokejumper/db'
import { createInvestigator } from '@smokejumper/engine'
import { createBuiltinRegistry, startNotificationDispatcher } from '@smokejumper/plugin-host'
import { createBus } from './bus.ts'
import { createOidcProvider, parseOidcEnv, type OidcConfig, type OidcProvider } from './oidc.ts'
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
const investigator = createInvestigator({ db, registry, bus, encryptionKey })
let oidcConfig: OidcConfig | undefined
try {
  oidcConfig = parseOidcEnv()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

let oidc: OidcProvider | undefined
if (oidcConfig) {
  try {
    oidc = await createOidcProvider(oidcConfig)
  } catch (err) {
    console.error(
      `OIDC/SSO is disabled because discovery failed; password login remains available: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
const app = await buildServer({ db, encryptionKey, bus, registry, investigator, oidc })
await app.listen({ port: Number(process.env.PORT ?? 3400), host: '0.0.0.0' })
