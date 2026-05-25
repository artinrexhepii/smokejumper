import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

export type Db = PostgresJsDatabase<Record<string, never>>

export function createDb(url: string): Db {
  return drizzle(postgres(url))
}
