'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, getAuthConfig, login, oidcStartUrl, setup, type AuthConfig } from '../../lib/api'
import { AuthLayout } from '../../components/AuthLayout'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    getAuthConfig()
      .then((config) => {
        if (!cancelled) setAuthConfig(config)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function onSignIn(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await login(email, password)
      router.push('/')
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Invalid email or password.'
          : 'Could not reach the Smokejumper server.',
      )
      setPending(false)
    }
  }

  async function onSetup(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await setup({ email, password, name, orgName })
      router.push('/')
    } catch {
      setError('Could not complete setup — check the details and try again.')
      setPending(false)
    }
  }

  const needsSetup = authConfig?.needsSetup ?? false

  return (
    <AuthLayout heroTitle={needsSetup ? 'Stand up your command console.' : 'When something breaks, the investigators are already on the way.'}>
      {authConfig === null ? (
        <div className="card login-card">
          <p className="loading">Loading…</p>
        </div>
      ) : needsSetup ? (
        <form className="card login-card" onSubmit={onSetup}>
          <h2>Create the first admin</h2>
          <p className="sub">This is a fresh install. The account you create owns the organization.</p>
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </label>
          <label>
            Organization name
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Acme" required />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="btn btn-accent"
            type="submit"
            disabled={pending}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {pending ? 'Setting up…' : 'Create admin & organization'}
          </button>
          <p className="hint">At least 8 characters. You can add teammates afterward from the Team page.</p>
        </form>
      ) : (
        <form className="card login-card" onSubmit={onSignIn}>
          <h2>Sign in</h2>
          <p className="sub">Enter the command console.</p>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="btn btn-accent"
            type="submit"
            disabled={pending}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
          {authConfig.oidc.enabled ? (
            <a className="btn" href={oidcStartUrl} style={{ width: '100%', justifyContent: 'center', marginTop: '0.6rem' }}>
              {authConfig.oidc.buttonLabel}
            </a>
          ) : null}
          {authConfig.allowSignup ? (
            <p className="hint">
              New here?{' '}
              <Link href="/signup" style={{ color: 'var(--ember-2)' }}>
                Create an account
              </Link>
            </p>
          ) : null}
        </form>
      )}
    </AuthLayout>
  )
}
