'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthConfig, signup, type AuthConfig } from '../../lib/api'
import { AuthLayout } from '../../components/AuthLayout'

export default function SignupPage() {
  const router = useRouter()
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAuthConfig()
      .then((cfg) => {
        if (!cancelled) setConfig(cfg)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await signup({ name, email, password })
      router.push('/')
    } catch {
      setError('Could not create your account — the email may already be registered, or its domain isn’t allowed.')
      setPending(false)
    }
  }

  return (
    <AuthLayout heroTitle="Join your team’s command console.">
      {config && !config.allowSignup ? (
        <div className="card login-card">
          <h2>Sign-up is closed</h2>
          <p className="sub">This Smokejumper doesn’t allow self-service sign-up. Ask an owner for an invite link.</p>
          <Link href="/login" className="btn" style={{ width: '100%', justifyContent: 'center' }}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="card login-card" onSubmit={onSubmit}>
          <h2>Create your account</h2>
          <p className="sub">You’ll join your organization as a member.</p>
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
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
            {pending ? 'Creating…' : 'Create account'}
          </button>
          <p className="hint">
            Already have an account?{' '}
            <Link href="/login" style={{ color: 'var(--ember-2)' }}>
              Sign in
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  )
}
