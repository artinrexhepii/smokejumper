import { describe, expect, it } from 'vitest'
import { createTestDb, verifyCredentials } from '@smokejumper/db'
import { seed } from '../src/seed.ts'

describe('seed', () => {
  it('creates org, admin user, and demo project idempotently', async () => {
    const db = await createTestDb()
    const first = await seed(db)
    const second = await seed(db)
    expect(second).toEqual(first)
    const user = await verifyCredentials(db, {
      email: 'admin@example.com',
      password: 'smokejumper',
    })
    expect(user?.id).toBe(first.userId)
  })
})
