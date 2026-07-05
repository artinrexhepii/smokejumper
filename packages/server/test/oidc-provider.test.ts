import { afterEach, describe, expect, it } from 'vitest'
import { createOidcProvider, type OidcProvider } from '../src/oidc.ts'
import { startMockIdp, type MockIdp } from './helpers/mock-idp.ts'

const CLIENT_ID = 'test-client'

let idp: MockIdp | undefined

afterEach(async () => {
  await idp?.close()
  idp = undefined
})

async function providerFor(mock: MockIdp): Promise<OidcProvider> {
  return createOidcProvider({
    issuer: mock.issuer,
    clientId: CLIENT_ID,
    clientSecret: 'test-secret',
    redirectUri: 'http://localhost:3400/api/auth/oidc/callback',
    scopes: 'openid email profile',
    defaultOrg: 'acme',
    defaultRole: 'member',
    buttonLabel: 'Sign in with SSO',
  })
}

async function driveAuthorize(start: {
  authorizationUrl: string
}): Promise<URL> {
  const res = await fetch(start.authorizationUrl, { redirect: 'manual' })
  const location = res.headers.get('location')
  if (!location) throw new Error('mock authorize did not redirect')
  return new URL(location)
}

describe('OidcProvider against the mock IdP', () => {
  it('discovers, builds an authorize url, and extracts email + name from the id_token', async () => {
    idp = await startMockIdp(CLIENT_ID)
    idp.setUser({ sub: 'user-1', email: 'alice@example.com', name: 'Alice Example' })
    const provider = await providerFor(idp)

    const start = await provider.start()
    expect(start.authorizationUrl.startsWith(`${idp.issuer}/authorize`)).toBe(true)
    const authUrl = new URL(start.authorizationUrl)
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('state')).toBe(start.state)
    expect(authUrl.searchParams.get('nonce')).toBe(start.nonce)

    const callbackUrl = await driveAuthorize(start)
    const user = await provider.callback(callbackUrl, {
      state: start.state,
      codeVerifier: start.codeVerifier,
      nonce: start.nonce,
    })
    expect(user).toEqual({ email: 'alice@example.com', name: 'Alice Example' })
  })

  it('falls back to email when the id_token has no name', async () => {
    idp = await startMockIdp(CLIENT_ID)
    idp.setUser({ sub: 'user-2', email: 'noname@example.com' })
    const provider = await providerFor(idp)
    const start = await provider.start()
    const callbackUrl = await driveAuthorize(start)
    const user = await provider.callback(callbackUrl, {
      state: start.state,
      codeVerifier: start.codeVerifier,
      nonce: start.nonce,
    })
    expect(user).toEqual({ email: 'noname@example.com', name: 'noname@example.com' })
  })

  it('rejects an id_token with no email claim', async () => {
    idp = await startMockIdp(CLIENT_ID)
    idp.setUser({ sub: 'user-3' })
    const provider = await providerFor(idp)
    const start = await provider.start()
    const callbackUrl = await driveAuthorize(start)
    await expect(
      provider.callback(callbackUrl, {
        state: start.state,
        codeVerifier: start.codeVerifier,
        nonce: start.nonce,
      }),
    ).rejects.toThrow(/email/)
  })

  it('exchanges the code using the configured redirect uri, not the request origin', async () => {
    idp = await startMockIdp(CLIENT_ID)
    idp.setUser({ sub: 'user-6', email: 'redirect@example.com', name: 'Redirect Example' })
    const provider = await providerFor(idp)

    const start = await provider.start()
    const callbackUrl = await driveAuthorize(start)
    const wrongOriginUrl = new URL(
      callbackUrl.pathname + callbackUrl.search,
      'http://wrong-host:9999',
    )
    const user = await provider.callback(wrongOriginUrl, {
      state: start.state,
      codeVerifier: start.codeVerifier,
      nonce: start.nonce,
    })
    expect(user).toEqual({ email: 'redirect@example.com', name: 'Redirect Example' })
  })

  it('rejects a state mismatch', async () => {
    idp = await startMockIdp(CLIENT_ID)
    idp.setUser({ sub: 'user-4', email: 'x@example.com' })
    const provider = await providerFor(idp)
    const start = await provider.start()
    const callbackUrl = await driveAuthorize(start)
    await expect(
      provider.callback(callbackUrl, {
        state: 'not-the-real-state',
        codeVerifier: start.codeVerifier,
        nonce: start.nonce,
      }),
    ).rejects.toThrow()
  })
})
