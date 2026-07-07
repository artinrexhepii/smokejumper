'use client'

import { useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  createInvite,
  listInvites,
  listMembers,
  removeMember,
  renameOrg,
  revokeInvite,
  setMemberRole,
  type CreatedInvite,
  type InviteView,
  type OrgMember,
  type OrgRole,
} from '../../../lib/api'
import { canManageOrg, useSession } from '../../../lib/useSession'

const ROLES: OrgRole[] = ['owner', 'admin', 'member']

export default function TeamPage() {
  const { session, loading, error } = useSession()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [members, setMembers] = useState<OrgMember[] | null>(null)
  const [invites, setInvites] = useState<InviteView[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const [inviteRole, setInviteRole] = useState<OrgRole>('member')
  const [inviteEmail, setInviteEmail] = useState('')
  const [generated, setGenerated] = useState<CreatedInvite | null>(null)
  const [copied, setCopied] = useState(false)

  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [renameSaved, setRenameSaved] = useState(false)

  const orgs = session?.orgs.filter((o) => canManageOrg(o.role)) ?? []
  const activeOrgId = orgId ?? orgs[0]?.id ?? null
  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null

  useEffect(() => {
    if (activeOrg) setOrgName(activeOrg.name)
  }, [activeOrg])

  useEffect(() => {
    if (!activeOrgId) return
    let cancelled = false
    Promise.all([listMembers(activeOrgId), listInvites(activeOrgId)])
      .then(([m, i]) => {
        if (cancelled) return
        setMembers(m)
        setInvites(i)
        setListError(null)
      })
      .catch(() => {
        if (!cancelled) setListError('Could not load the team.')
      })
    return () => {
      cancelled = true
    }
  }, [activeOrgId, reload])

  async function onChangeRole(member: OrgMember, role: OrgRole) {
    if (!activeOrgId || role === member.role) return
    try {
      await setMemberRole(activeOrgId, member.userId, role)
      setReload((r) => r + 1)
    } catch (err) {
      setListError(
        err instanceof ApiError && err.status === 409
          ? 'That organization must keep at least one owner.'
          : 'Could not change the role — try again.',
      )
    }
  }

  async function onRemove(member: OrgMember) {
    if (!activeOrgId) return
    try {
      await removeMember(activeOrgId, member.userId)
      setConfirmRemove(null)
      setReload((r) => r + 1)
    } catch (err) {
      setListError(
        err instanceof ApiError && err.status === 409
          ? 'You can’t remove the last owner.'
          : 'Could not remove the member — try again.',
      )
    }
  }

  async function onCreateInvite(e: FormEvent) {
    e.preventDefault()
    if (!activeOrgId) return
    setListError(null)
    setCopied(false)
    try {
      const invite = await createInvite(activeOrgId, {
        role: inviteRole,
        email: inviteEmail.trim() || undefined,
      })
      setGenerated(invite)
      setInviteEmail('')
      setReload((r) => r + 1)
    } catch {
      setListError('Could not create the invite — try again.')
    }
  }

  async function onRevoke(invite: InviteView) {
    if (!activeOrgId) return
    try {
      await revokeInvite(activeOrgId, invite.id)
      setReload((r) => r + 1)
    } catch {
      setListError('Could not revoke the invite — try again.')
    }
  }

  async function onRename(e: FormEvent) {
    e.preventDefault()
    if (!activeOrgId || !orgName.trim()) return
    setRenameSaved(false)
    try {
      await renameOrg(activeOrgId, orgName.trim())
      setRenameSaved(true)
    } catch {
      setListError('Could not rename the organization — try again.')
    }
  }

  async function copyLink() {
    if (!generated) return
    try {
      await navigator.clipboard.writeText(generated.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (loading) return <p className="loading">Loading…</p>
  if (error) return <p className="error-text">{error}</p>
  if (!session) return null
  if (orgs.length === 0) {
    return <p className="empty">You are not an owner or admin of any organization.</p>
  }

  return (
    <>
      <div className="board-hero">
        <div>
          <span className="board-hero-eyebrow">Configure</span>
          <h1>Team</h1>
          <p>Invite teammates, set who can configure sources and confirm verdicts, and name your organization.</p>
        </div>
        {orgs.length > 1 ? (
          <div className="scope-picker">
            <div className="scope-field">
              <span className="scope-label">Organization</span>
              <select
                aria-label="Organization"
                value={activeOrgId ?? ''}
                onChange={(e) => {
                  setOrgId(e.target.value)
                  setMembers(null)
                  setInvites(null)
                  setGenerated(null)
                }}
              >
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </div>

      {listError ? <p className="error-text">{listError}</p> : null}

      <div className="card" data-tour="team-members">
        <h2>Members</h2>
        {members === null ? (
          <p className="loading">Loading members…</p>
        ) : (
          <ul className="instance-list" style={{ marginTop: '0.9rem' }}>
            {members.map((member) => (
              <li key={member.userId} className="instance-row">
                <span className="instance-name">
                  {member.name} <span className="text-dim">· {member.email}</span>
                </span>
                <select
                  aria-label={`Role for ${member.email}`}
                  value={member.role}
                  onChange={(e) => onChangeRole(member, e.target.value as OrgRole)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {confirmRemove === member.userId ? (
                  <span className="confirm-delete">
                    <button type="button" className="btn" onClick={() => onRemove(member)}>
                      confirm
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmRemove(null)}>
                      cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmRemove(member.userId)}>
                    remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" data-tour="team-invite">
        <h2>Invite a teammate</h2>
        <p className="text-dim" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0.9rem' }}>
          Generate a link and share it however you like — no email server required. Leave the email blank for a link
          anyone can use, or pin it to one address.
        </p>
        <form onSubmit={onCreateInvite} style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div className="scope-field">
            <span className="scope-label">Role</span>
            <select aria-label="Invite role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as OrgRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="scope-field" style={{ flex: 1, minWidth: 200 }}>
            <span className="scope-label">Email (optional)</span>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="pin to an address, or leave blank"
            />
          </div>
          <button type="submit" className="btn btn-accent" style={{ alignSelf: 'flex-end' }}>
            Create invite link
          </button>
        </form>

        {generated ? (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem' }}>
            <input readOnly value={generated.url} aria-label="Invite link" style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={copyLink}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        ) : null}

        <h3>Pending invites</h3>
        {invites === null ? (
          <p className="loading">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="empty">No pending invites.</p>
        ) : (
          <ul className="instance-list">
            {invites.map((invite) => (
              <li key={invite.id} className="instance-row">
                <span className="instance-name">{invite.email ?? 'anyone with the link'}</span>
                <span className="badge">{invite.role}</span>
                <button type="button" className="btn btn-ghost" onClick={() => onRevoke(invite)}>
                  revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" data-tour="team-org">
        <h2>Organization</h2>
        <form onSubmit={onRename} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '0.75rem' }}>
          <input
            value={orgName}
            onChange={(e) => {
              setOrgName(e.target.value)
              setRenameSaved(false)
            }}
            aria-label="Organization name"
            maxLength={80}
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn" disabled={!orgName.trim() || orgName.trim() === activeOrg?.name}>
            Save
          </button>
        </form>
        {renameSaved ? <p className="install-note">Saved. The new name shows after a reload.</p> : null}
      </div>
    </>
  )
}
