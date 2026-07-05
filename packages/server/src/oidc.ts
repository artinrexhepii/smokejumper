import * as client from 'openid-client'
import type { OrgRole } from '@smokejumper/db'

export interface OidcConfig {
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string
  defaultOrg: string
  defaultRole: OrgRole
  buttonLabel: string
}

export interface OidcStart {
  authorizationUrl: string
  state: string
  codeVerifier: string
  nonce: string
}

export interface OidcUser {
  email: string
  name: string
}

export interface OidcProvider {
  readonly buttonLabel: string
  readonly defaultOrg: string
  readonly defaultRole: OrgRole
  start(): Promise<OidcStart>
  callback(
    currentUrl: URL,
    checks: { state: string; codeVerifier: string; nonce: string },
  ): Promise<OidcUser>
}

const ROLES: readonly OrgRole[] = ['owner', 'admin', 'member']

export function parseOidcEnv(env: NodeJS.ProcessEnv = process.env): OidcConfig | undefined {
  const issuer = env.OIDC_ISSUER
  if (!issuer) return undefined

  const missing: string[] = []
  if (!env.OIDC_CLIENT_ID) missing.push('OIDC_CLIENT_ID')
  if (!env.OIDC_CLIENT_SECRET) missing.push('OIDC_CLIENT_SECRET')
  if (!env.OIDC_DEFAULT_ORG) missing.push('OIDC_DEFAULT_ORG')
  if (missing.length > 0) {
    throw new Error(
      `OIDC_ISSUER is set but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`,
    )
  }

  const role = (env.OIDC_DEFAULT_ROLE ?? 'member') as OrgRole
  if (!ROLES.includes(role)) {
    throw new Error(`OIDC_DEFAULT_ROLE must be one of owner, admin, member (got "${role}")`)
  }

  const publicBaseUrl = env.PUBLIC_BASE_URL ?? 'http://localhost:3400'
  return {
    issuer,
    clientId: env.OIDC_CLIENT_ID!,
    clientSecret: env.OIDC_CLIENT_SECRET!,
    redirectUri: env.OIDC_REDIRECT_URI ?? `${publicBaseUrl}/api/auth/oidc/callback`,
    scopes: env.OIDC_SCOPES ?? 'openid email profile',
    defaultOrg: env.OIDC_DEFAULT_ORG!,
    defaultRole: role,
    buttonLabel: env.OIDC_BUTTON_LABEL ?? 'Sign in with SSO',
  }
}

export async function createOidcProvider(cfg: OidcConfig): Promise<OidcProvider> {
  const issuerUrl = new URL(cfg.issuer)
  // Discovery + token + jwks over plain HTTP is allowed only for http: issuers (the offline
  // mock IdP and local dev). Production issuers are https: and stay strict.
  const allowInsecure = issuerUrl.protocol === 'http:'
  const config = await client.discovery(
    issuerUrl,
    cfg.clientId,
    cfg.clientSecret,
    undefined,
    allowInsecure ? { execute: [client.allowInsecureRequests] } : undefined,
  )

  return {
    buttonLabel: cfg.buttonLabel,
    defaultOrg: cfg.defaultOrg,
    defaultRole: cfg.defaultRole,

    async start() {
      const codeVerifier = client.randomPKCECodeVerifier()
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
      const state = client.randomState()
      const nonce = client.randomNonce()
      const authorizationUrl = client
        .buildAuthorizationUrl(config, {
          redirect_uri: cfg.redirectUri,
          scope: cfg.scopes,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state,
          nonce,
        })
        .href
      return { authorizationUrl, state, codeVerifier, nonce }
    },

    async callback(currentUrl, checks) {
      const exchangeUrl = new URL(cfg.redirectUri)
      exchangeUrl.search = currentUrl.search
      const tokens = await client.authorizationCodeGrant(config, exchangeUrl, {
        pkceCodeVerifier: checks.codeVerifier,
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        idTokenExpected: true,
      })
      const claims = tokens.claims()
      const email = typeof claims?.email === 'string' ? claims.email : undefined
      if (!email) throw new Error('id_token is missing a required email claim')
      const name = typeof claims?.name === 'string' && claims.name.length > 0 ? claims.name : email
      return { email, name }
    },
  }
}
