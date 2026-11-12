import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, type Role } from '../lib/auth'
import { fmtDate } from '../lib/metrics'
import Modal from '../components/Modal'

type Member = { user_id: string; email: string; role: Role; created_at: string }

function makePassword() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const r = crypto.getRandomValues(new Uint32Array(12))
  const s = [...r].map((n) => a[n % a.length]).join('')
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}

export default function Team() {
  const { role, userId, loginEnabled } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [resetFor, setResetFor] = useState<Member | null>(null)
  const isAdmin = role === 'admin'

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('team_members').select('*').order('created_at')
    if (error) setErr(error.message)
    else setMembers(data as Member[])
  }, [])
  useEffect(() => { if (loginEnabled) load() }, [load, loginEnabled])

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setErr(null)
    const { error } = await fn()
    if (error) setErr(error.message)
    await load()
  }

  if (!loginEnabled) return <div className="wrap"><h1>Team</h1><p className="sub">Login is switched off, so there are no accounts to manage.</p></div>

  return (
    <div className="wrap" style={{ maxWidth: 900 }}>
      <header className="page-head">
        <div>
          <h1>Team</h1>
          <p className="sub">{members.length} member{members.length === 1 ? '' : 's'} · only people listed here can sign in and see data</p>
        </div>
        {isAdmin && <button type="button" className="btn" onClick={() => setAdding(true)}>Add member</button>}
      </header>
      {err && <div className="notice err" role="alert">{err}</div>}

      <section className="card table-scroll" aria-label="Team members">
        <table className="preview" style={{ minWidth: 640 }}>
          <thead><tr><th style={{ paddingLeft: 28 }}>Email</th><th>Role</th><th>Added</th>{isAdmin && <th style={{ textAlign: 'right', paddingRight: 28 }}>Actions</th>}</tr></thead>
          <tbody>
            {members.map((m) => {
              const me = m.user_id === userId
              return (
                <tr key={m.user_id}>
                  <td style={{ paddingLeft: 28, fontWeight: 500 }}>{m.email}{me && <span className="small"> (you)</span>}</td>
                  <td>
                    {isAdmin && !me ? (
                      <select aria-label={`Role for ${m.email}`} value={m.role} onChange={(e) => run(() => supabase.rpc('admin_set_role', { p_user: m.user_id, p_role: e.target.value }))}
                        style={{ height: 36, borderRadius: 10, border: '1px solid var(--field)', padding: '0 10px', background: '#fff', color: 'var(--ink)', fontSize: 14 }}>
                        <option value="member">Member</option><option value="admin">Admin</option>
                      </select>
                    ) : <span style={{ textTransform: 'capitalize' }}>{m.role}</span>}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{fmtDate(m.created_at.slice(0, 10))}</td>
                  {isAdmin && (
                    <td style={{ textAlign: 'right', paddingRight: 20, whiteSpace: 'nowrap' }}>
                      <button type="button" className="linkbtn" onClick={() => setResetFor(m)}>Reset password</button>
                      {!me && <button type="button" className="linkbtn" style={{ color: 'var(--err)', marginLeft: 16 }} onClick={() => {
                        if (window.confirm(`Remove ${m.email}? They will no longer be able to sign in.`)) run(() => supabase.rpc('admin_remove_user', { p_user: m.user_id }))
                      }}>Remove</button>}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <ChangeMyPassword />

      <Modal title="Add a team member" open={adding} onClose={() => setAdding(false)}>
        {adding && <AddMember onDone={() => { setAdding(false); load() }} />}
      </Modal>
      <Modal title={`Reset password · ${resetFor?.email ?? ''}`} open={!!resetFor} onClose={() => setResetFor(null)}>
        {resetFor && <ResetPassword member={resetFor} onDone={() => setResetFor(null)} />}
      </Modal>
    </div>
  )
}

function PasswordField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <input id={id} type="text" required minLength={8} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" />
      <button type="button" className="btn subtle" onClick={() => onChange(makePassword())}>Generate</button>
    </div>
  )
}

function AddMember({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState(makePassword())
  const [role, setRole] = useState<Role>('member')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    const { error } = await supabase.rpc('admin_create_user', { p_email: email, p_password: pw, p_role: role })
    setBusy(false)
    if (error) setErr(error.message)
    else setCreated(true)
  }

  if (created)
    return (
      <div className="form">
        <div className="notice ok">Account created. Send these sign-in details to them:</div>
        <div className="card" style={{ padding: 16, fontFamily: 'ui-monospace, monospace', fontSize: 14, lineHeight: 1.8 }}>
          Link: {window.location.origin}<br />Email: {email.trim().toLowerCase()}<br />Password: {pw}
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(`Optimization Tracker\nLink: ${window.location.origin}\nEmail: ${email.trim().toLowerCase()}\nPassword: ${pw}`)}>Copy details</button>
          <button type="button" className="btn subtle" onClick={onDone}>Done</button>
        </div>
      </div>
    )

  return (
    <form className="form" onSubmit={submit}>
      <div className="field"><label htmlFor="tm-email">Email</label><input id="tm-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label htmlFor="tm-pw">Password <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(at least 8 characters)</span></label><PasswordField id="tm-pw" value={pw} onChange={setPw} /></div>
      <div className="field"><label htmlFor="tm-role">Role</label>
        <select id="tm-role" value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="member">Member: view and add data</option><option value="admin">Admin: also manage the team</option></select></div>
      {err && <div className="notice err" role="alert">{err}</div>}
      <div className="actions"><button type="submit" className="btn lg" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <button type="button" className="btn subtle lg" onClick={onDone}>Cancel</button></div>
    </form>
  )
}

function ResetPassword({ member, onDone }: { member: Member; onDone: () => void }) {
  const [pw, setPw] = useState(makePassword())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    const { error } = await supabase.rpc('admin_set_password', { p_user: member.user_id, p_password: pw })
    setBusy(false)
    if (error) setErr(error.message); else setDone(true)
  }
  if (done) return (
    <div className="form">
      <div className="notice ok">Password changed. New password for {member.email}: <b style={{ fontFamily: 'ui-monospace, monospace' }}>{pw}</b></div>
      <div><button type="button" className="btn" onClick={onDone}>Done</button></div>
    </div>
  )
  return (
    <form className="form" onSubmit={submit}>
      <div className="field"><label htmlFor="rp-pw">New password</label><PasswordField id="rp-pw" value={pw} onChange={setPw} /></div>
      {err && <div className="notice err" role="alert">{err}</div>}
      <div className="actions"><button type="submit" className="btn lg" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
        <button type="button" className="btn subtle lg" onClick={onDone}>Cancel</button></div>
    </form>
  )
}

function ChangeMyPassword() {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null)
    if (pw.length < 8) return setMsg({ kind: 'err', text: 'Use at least 8 characters.' })
    if (pw !== pw2) return setMsg({ kind: 'err', text: 'The two passwords don’t match.' })
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) setMsg({ kind: 'err', text: error.message })
    else { setMsg({ kind: 'ok', text: 'Your password has been changed.' }); setPw(''); setPw2('') }
  }
  return (
    <form className="card form" onSubmit={submit} aria-label="Change my password">
      <h2>Change my password</h2>
      <div className="fgrid">
        <div className="field"><label htmlFor="my-pw">New password</label><input id="my-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <div className="field"><label htmlFor="my-pw2">Repeat new password</label><input id="my-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
      </div>
      {msg && <div className={'notice ' + msg.kind} role="status">{msg.text}</div>}
      <div><button type="submit" className="btn lg" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
    </form>
  )
}
