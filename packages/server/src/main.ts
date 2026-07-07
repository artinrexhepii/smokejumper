import { createDb, runMigrations } from '@smokejumper/db'
import { createInvestigator } from '@smokejumper/engine'
import { createBuiltinRegistry, loadInstalledPlugins, startNotificationDispatcher } from '@smokejumper/plugin-host'
import { applyAutoUpdates, FIRST_PARTY_INDEX_PATH, resolveTrustKeys } from '@smokejumper/registry'
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

const pluginsDir = process.env.SMOKEJUMPER_PLUGINS_DIR ?? './plugins-installed'
const trustKeys = resolveTrustKeys(process.env.SMOKEJUMPER_PLUGIN_TRUST_KEYS)
const registryUrl = process.env.SMOKEJUMPER_REGISTRY_URL
const autoUpdate = process.env.SMOKEJUMPER_PLUGIN_AUTOUPDATE === '1'

// Boot-time discovery only — no runtime register/unregister, no hot reload.
// A bundle that fails verification is skipped and logged; it never crashes boot.
const loadReport = await loadInstalledPlugins({ registry, dir: pluginsDir, trustKeys })
for (const skipped of loadReport.skipped) {
  console.error(`[registry-loader] skipped plugin bundle "${skipped.bundle}": ${skipped.reason}`)
}
if (loadReport.loaded.length > 0) {
  console.log(`[registry-loader] loaded installed plugins: ${loadReport.loaded.join(', ')}`)
}

if (autoUpdate) {
  try {
    const applied = await applyAutoUpdates({ dir: pluginsDir, bundledIndexPath: FIRST_PARTY_INDEX_PATH, registryUrl, trustKeys })
    if (applied.length > 0) {
      console.log(
        `[registry-loader] auto-installed updates, applied on next restart: ${applied.map((c) => `${c.id}@${c.toVersion}`).join(', ')}`,
      )
    }
  } catch (err) {
    console.error(`[registry-loader] auto-update check failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

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
const app = await buildServer({
  db,
  encryptionKey,
  bus,
  registry,
  investigator,
  oidc,
  registryClient: { db, pluginsDir, bundledIndexPath: FIRST_PARTY_INDEX_PATH, registryUrl, trustKeys, autoUpdate },
})
await app.listen({ port: Number(process.env.PORT ?? 3400), host: '0.0.0.0' })
