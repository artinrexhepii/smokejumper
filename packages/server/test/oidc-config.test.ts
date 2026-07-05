import { describe, expect, it } from 'vitest'
import { parseOidcEnv } from '../src/oidc.ts'

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv
}

describe('parseOidcEnv', () => {
  it('returns undefined when OIDC_ISSUER is unset (disabled)', () => {
    expect(parseOidcEnv(env({}))).toBeUndefined()
  })

  it('fails fast when issuer is set but required fields are missing', () => {
    expect(() => parseOidcEnv(env({ OIDC_ISSUER: 'https://idp.example.com' }))).toThrow(
      /OIDC_CLIENT_ID/,
    )
    expect(() =>
      parseOidcEnv(
        env({
          OIDC_ISSUER: 'https://idp.example.com',
          OIDC_CLIENT_ID: 'client',
          OIDC_CLIENT_SECRET: 'secret',
        }),
      ),
    ).toThrow(/OIDC_DEFAULT_ORG/)
  })

  it('applies defaults for optional fields', () => {
    const cfg = parseOidcEnv(
      env({
        OIDC_ISSUER: 'https://idp.example.com',
        OIDC_CLIENT_ID: 'client',
        OIDC_CLIENT_SECRET: 'secret',
        OIDC_DEFAULT_ORG: 'acme',
      }),
    )
    expect(cfg).toEqual({
      issuer: 'https://idp.example.com',
      clientId: 'client',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3400/api/auth/oidc/callback',
      scopes: 'openid email profile',
      defaultOrg: 'acme',
      defaultRole: 'member',
      buttonLabel: 'Sign in with SSO',
    })
  })

  it('honors overrides including PUBLIC_BASE_URL for the redirect uri', () => {
    const cfg = parseOidcEnv(
      env({
        OIDC_ISSUER: 'https://idp.example.com',
        OIDC_CLIENT_ID: 'client',
        OIDC_CLIENT_SECRET: 'secret',
        OIDC_DEFAULT_ORG: 'acme',
        OIDC_DEFAULT_ROLE: 'admin',
        OIDC_SCOPES: 'openid email',
        OIDC_BUTTON_LABEL: 'Corp login',
        PUBLIC_BASE_URL: 'https://sj.example.com',
      }),
    )
    expect(cfg?.redirectUri).toBe('https://sj.example.com/api/auth/oidc/callback')
    expect(cfg?.defaultRole).toBe('admin')
    expect(cfg?.scopes).toBe('openid email')
    expect(cfg?.buttonLabel).toBe('Corp login')
  })

  it('rejects an invalid default role', () => {
    expect(() =>
      parseOidcEnv(
        env({
          OIDC_ISSUER: 'https://idp.example.com',
          OIDC_CLIENT_ID: 'client',
          OIDC_CLIENT_SECRET: 'secret',
          OIDC_DEFAULT_ORG: 'acme',
          OIDC_DEFAULT_ROLE: 'superuser',
        }),
      ),
    ).toThrow(/OIDC_DEFAULT_ROLE/)
  })
})
