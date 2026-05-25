import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function loadKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64')
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes, base64-encoded')
  return key
}

export function encryptJson(value: unknown, keyB64: string): string {
  const key = loadKey(keyB64)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

export function decryptJson(payload: string, keyB64: string): unknown {
  const key = loadKey(keyB64)
  const parts = payload.split(':')
  const [version, ivB64, tagB64, dataB64] = parts
  if (parts.length !== 4 || version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('malformed encrypted payload')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
  return JSON.parse(plaintext.toString('utf8'))
}
