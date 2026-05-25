import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import type { Db } from './db.ts'
import { migrationsTable } from './schema.ts'

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))

export function splitStatements(sqlText: string): string[] {
  return sqlText
    .split(';')
    .map((chunk) => chunk.trim())
    .filter((chunk) =>
      chunk.split('\n').some((line) => line.trim() !== '' && !line.trim().startsWith('--')),
    )
}

export async function runMigrations(db: Db): Promise<void> {
  await db.execute(
    sql.raw(
      'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    ),
  )
  const applied = new Set((await db.select().from(migrationsTable)).map((m) => m.name))
  let files: string[]
  try {
    files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  for (const file of files) {
    if (applied.has(file)) continue
    const text = await readFile(join(migrationsDir, file), 'utf8')
    for (const statement of splitStatements(text)) {
      await db.execute(sql.raw(statement))
    }
    await db.insert(migrationsTable).values({ name: file })
  }
}
