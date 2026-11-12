import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'link'

export default function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMsg(null); setBusy(true)
    const redirect = window.location.origin
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } })
        if (error) throw error
        if (!data.session) setMsg({ kind: 'ok', text: 'Account created. Check your email and click the confirmation link, then sign in.' })
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: false } })
        if (error) throw error
        setMsg({ kind: 'ok', text: 'Check your email for a sign-in link.' })
      }
    } catch (err) {
      const m = (err as Error).message
      setMsg({ kind: 'err', text: /Invalid login/i.test(m) ? 'Wrong email or password.' : /not confirmed/i.test(m) ? 'Please confirm your email first (check your inbox).' : m })
    } finally {
      setBusy(false)
    }
  }

  const TABS: [Mode, string][] = [['signin', 'Sign in'], ['signup', 'Create account'], ['link', 'Email me a link']]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
          </div>
          <div>Optimization<br />Tracker</div>
        </div>
        <form className="card form" onSubmit={submit} style={{ gap: 20 }}>
          <h1 style={{ fontSize: 26 }}>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
          <div className="tabs" role="tablist" aria-label="Sign-in method">
            {TABS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} className={'tab' + (mode === k ? ' on' : '')} style={{ fontSize: 14 }} onClick={() => { setMode(k); setMsg(null) }}>{label}</button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {mode !== 'link' && (
            <div className="field">
              <label htmlFor="pw">Password</label>
              <input id="pw" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
              {mode === 'signup' && <span className="small">At least 6 characters.</span>}
            </div>
          )}
          {msg && <div className={'notice ' + msg.kind} role="status">{msg.text}</div>}
          <button type="submit" className="btn lg" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send link'}
          </button>
        </form>
      </div>
    </div>
  )
}
