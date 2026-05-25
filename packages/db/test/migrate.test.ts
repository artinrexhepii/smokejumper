import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, migrationsTable, runMigrations, splitStatements } from '../src/index.ts'

describe('splitStatements', () => {
  it('splits on semicolons and drops comment-only chunks', () => {
    const text = [
      '-- identity tables',
      'CREATE TABLE a (id int);',
      '',
      '-- second table',
      'CREATE TABLE b (id int);',
      '',
    ].join('\n')
    const statements = splitStatements(text)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('CREATE TABLE a')
    expect(statements[1]).toContain('CREATE TABLE b')
  })
})

describe('createTestDb', () => {
  it('creates a pglite database with the migrations table', async () => {
    const db = await createTestDb()
    const applied = await db.select().from(migrationsTable)
    expect(Array.isArray(applied)).toBe(true)
  })

  it('is idempotent across repeated runs', async () => {
    const db = await createTestDb()
    const before = (await db.select().from(migrationsTable)).map((m) => m.name)
    await runMigrations(db)
    const after = (await db.select().from(migrationsTable)).map((m) => m.name)
    expect(after).toEqual(before)
  })

  it('supports the pgvector extension', async () => {
    const db = await createTestDb()
    await db.execute(sql.raw('CREATE EXTENSION IF NOT EXISTS vector'))
    await db.execute(sql.raw("SELECT '[1,2,3]'::vector"))
  })
})
