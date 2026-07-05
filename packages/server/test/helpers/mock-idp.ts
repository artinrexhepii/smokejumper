import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'

export interface MockIdpUser {
  sub: string
  email?: string
  name?: string
}

export interface MockIdp {
  issuer: string
  setUser(user: MockIdpUser): void
  close(): Promise<void>
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export async function startMockIdp(clientId: string): Promise<MockIdp> {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const publicJwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig',
  }

  const codeNonces = new Map<string, { nonce: string | null; redirectUri: string }>()
  let user: MockIdpUser = { sub: 'user-1', email: 'alice@example.com', name: 'Alice Example' }
  let issuer = ''

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', issuer)

    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        scopes_supported: ['openid', 'email', 'profile'],
        claims_supported: ['sub', 'email', 'name'],
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri')
      if (!redirectUri) {
        json(res, 400, { error: 'missing redirect_uri' })
        return
      }
      const code = randomBytes(16).toString('hex')
      codeNonces.set(code, { nonce: url.searchParams.get('nonce'), redirectUri })
      const location = new URL(redirectUri)
      location.searchParams.set('code', code)
      const state = url.searchParams.get('state')
      if (state) location.searchParams.set('state', state)
      res.writeHead(302, { location: location.href })
      res.end()
      return
    }

    if (req.method === 'POST' && url.pathname === '/token') {
      const params = new URLSearchParams(await readBody(req))
      const code = params.get('code') ?? ''
      const stored = codeNonces.get(code) ?? null
      codeNonces.delete(code)
      if (!stored || params.get('redirect_uri') !== stored.redirectUri) {
        json(res, 400, { error: 'invalid_grant' })
        return
      }
      const payload: Record<string, unknown> = { sub: user.sub }
      if (user.email !== undefined) payload.email = user.email
      if (user.name !== undefined) payload.name = user.name
      if (stored.nonce) payload.nonce = stored.nonce
      const idToken = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(issuer)
        .setSubject(user.sub)
        .setAudience(clientId)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey)
      json(res, 200, {
        access_token: 'mock-access-token',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: idToken,
        scope: 'openid email profile',
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/jwks') {
      json(res, 200, { keys: [publicJwk] })
      return
    }

    json(res, 404, { error: 'not found' })
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      json(res, 500, { error: String(err) })
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  issuer = `http://127.0.0.1:${port}`

  return {
    issuer,
    setUser(next) {
      user = next
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}
