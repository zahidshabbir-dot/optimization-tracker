import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

function Brand() {
  return (
    <div className="brand" style={{ padding: 0 }}>
      <div className="brand-mark">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
      </div>
      <div>Optimization<br />Tracker</div>
    </div>
  )
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Brand />
        {children}
      </div>
    </div>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setErr(/Invalid login/i.test(error.message) ? 'Wrong email or password.' : error.message)
    setBusy(false)
  }

  return (
    <AuthShell>
      <form className="card form" onSubmit={submit} style={{ gap: 20 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Sign in</h1>
          <p className="sub">Use the account your admin gave you.</p>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <div style={{ position: 'relative' }}>
            <input id="pw" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 70 }} />
            <button type="button" className="linkbtn" onClick={() => setShow(!show)} style={{ position: 'absolute', right: 14, top: 13 }} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
          </div>
        </div>
        {err && <div className="notice err" role="alert">{err}</div>}
        <button type="submit" className="btn lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small" style={{ margin: 0 }}>Forgot your password? Ask your admin to reset it.</p>
      </form>
    </AuthShell>
  )
}

export function NoAccess() {
  const { email, signOut } = useAuth()
  return (
    <AuthShell>
      <div className="card form" style={{ gap: 16 }}>
        <h1 style={{ fontSize: 24 }}>No access yet</h1>
        <p className="sub" style={{ margin: 0 }}>You're signed in as <b>{email}</b>, but this account isn't on the team. Ask an admin to add you.</p>
        <div><button type="button" className="btn subtle lg" onClick={signOut}>Sign out</button></div>
      </div>
    </AuthShell>
  )
}
