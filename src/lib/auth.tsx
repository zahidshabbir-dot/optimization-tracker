import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BACKEND, supabase } from './supabase'

export type Role = 'admin' | 'member'
type Auth = {
  ready: boolean
  email: string | null
  userId: string | null
  signedIn: boolean
  /** null = signed in but not on the team */
  role: Role | null
  loginEnabled: boolean
  signOut: () => Promise<void>
}
const Ctx = createContext<Auth | null>(null)

// Login is on unless the app runs on the local test server, or VITE_REQUIRE_LOGIN=false.
const LOGIN = BACKEND === 'supabase' && import.meta.env.VITE_REQUIRE_LOGIN !== 'false'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [ready, setReady] = useState(!LOGIN)

  const loadRole = useCallback(async (s: Session | null) => {
    if (!s) { setRole(null); setReady(true); return }
    const { data } = await supabase.from('team_members').select('role').eq('user_id', s.user.id).maybeSingle()
    setRole((data?.role as Role) ?? null)
    setReady(true)
  }, [])

  useEffect(() => {
    if (!LOGIN) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); loadRole(data.session) })
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') { setReady(false); loadRole(s) }
    })
    return () => data.subscription.unsubscribe()
  }, [loadRole])

  const value: Auth = !LOGIN
    ? { ready: true, email: BACKEND === 'local' ? 'Local mode' : null, userId: null, signedIn: true, role: 'admin', loginEnabled: false, signOut: async () => {} }
    : { ready, email: session?.user.email ?? null, userId: session?.user.id ?? null, signedIn: !!session, role, loginEnabled: true, signOut: async () => { await supabase.auth.signOut() } }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
