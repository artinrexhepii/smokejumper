'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, login } from '../../lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent) {
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

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={onSubmit}>
        <h1>Sign in</h1>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn-accent" type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="hint">seeded dev login: admin@example.com / smokejumper</p>
      </form>
    </div>
  )
}
