'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { acceptInvite, previewInvite, type InvitePreview } from '../../../lib/api'
import { AuthLayout } from '../../../components/AuthLayout'

export default function JoinPage() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = params.token
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    previewInvite(token)
      .then((p) => {
        if (!cancelled) setPreview(p)
      })
      .catch(() => {
        if (!cancelled) setPreview({ valid: false })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await acceptInvite(token, { name, password, email: preview?.email ? undefined : email })
      router.push('/')
    } catch {
      setError('Could not accept this invite — it may have expired, or the email is already registered.')
      setPending(false)
    }
  }

  return (
    <AuthLayout heroTitle="You’ve been invited to a dispatch team.">
      {preview === null ? (
        <div className="card login-card">
          <p className="loading">Loading…</p>
        </div>
      ) : !preview.valid ? (
        <div className="card login-card">
          <h2>This invite isn’t valid</h2>
          <p className="sub">It may have already been used or expired. Ask an owner for a fresh link.</p>
          <Link href="/login" className="btn" style={{ width: '100%', justifyContent: 'center' }}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="card login-card" onSubmit={onSubmit}>
          <h2>Join {preview.orgName}</h2>
          <p className="sub">
            You’re joining as <b>{preview.role}</b>. Set your name and a password.
          </p>
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </label>
          <label>
            Email
            {preview.email ? (
              <input type="email" value={preview.email} disabled />
            ) : (
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            )}
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
            {pending ? 'Joining…' : `Join ${preview.orgName}`}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
