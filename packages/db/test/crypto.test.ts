import { describe, expect, it } from 'vitest'
import { decryptJson, encryptJson } from '../src/index.ts'

const KEY = Buffer.alloc(32, 7).toString('base64')
const OTHER_KEY = Buffer.alloc(32, 8).toString('base64')

describe('envelope crypto', () => {
  it('round-trips json values', () => {
    const value = { botToken: 'xoxb-1', nested: { a: [1, 2, 3] } }
    const payload = encryptJson(value, KEY)
    expect(payload).toMatch(/^v1:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/)
    expect(decryptJson(payload, KEY)).toEqual(value)
  })

  it('produces a fresh iv per encryption', () => {
    expect(encryptJson({ a: 1 }, KEY)).not.toBe(encryptJson({ a: 1 }, KEY))
  })

  it('fails with the wrong key', () => {
    const payload = encryptJson({ secret: true }, KEY)
    expect(() => decryptJson(payload, OTHER_KEY)).toThrow()
  })

  it('fails when the ciphertext is tampered with', () => {
    const payload = encryptJson({ secret: true }, KEY)
    const parts = payload.split(':')
    const data = parts[3]!
    const flipped = (data.startsWith('A') ? 'B' : 'A') + data.slice(1)
    expect(() => decryptJson([parts[0], parts[1], parts[2], flipped].join(':'), KEY)).toThrow()
  })

  it('rejects malformed payloads and short keys', () => {
    expect(() => decryptJson('v2:a:b:c', KEY)).toThrow('malformed')
    expect(() => encryptJson({}, Buffer.alloc(16, 1).toString('base64'))).toThrow('32 bytes')
  })

  it('rejects payloads with trailing segments', () => {
    const payload = encryptJson({ secret: true }, KEY)
    expect(() => decryptJson(`${payload}:extra`, KEY)).toThrow('malformed')
  })
})
