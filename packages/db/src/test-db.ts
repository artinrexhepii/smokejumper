import type { Db } from './db.ts'
import { runMigrations } from './migrate.ts'

export async function createTestDb(): Promise<Db> {
  const [{ PGlite }, { vector }, { drizzle }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite-pgvector'),
    import('drizzle-orm/pglite'),
  ])
  const client = new PGlite({ extensions: { vector } })
  // PgliteDatabase and PostgresJsDatabase expose the same query-builder surface;
  // the cast keeps a single Db type across prod and tests.
  const db = drizzle(client) as unknown as Db
  await runMigrations(db)
  return db
}
