import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BACKEND, supabase } from './supabase'

type Auth = { ready: boolean; email: string | null; signedIn: boolean; signOut: () => Promise<void> }
const Ctx = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  // Login is off unless VITE_REQUIRE_LOGIN=true (turn it on together with the auth-only database policies).
  const local = BACKEND === 'local' || import.meta.env.VITE_REQUIRE_LOGIN !== 'true'
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(local)

  useEffect(() => {
    if (local) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); setReady(true) })
    return () => data.subscription.unsubscribe()
  }, [local])

  const value: Auth = local
    ? { ready: true, email: BACKEND === 'local' ? 'Local mode' : null, signedIn: true, signOut: async () => {} }
    : { ready, email: session?.user.email ?? null, signedIn: !!session, signOut: async () => { await supabase.auth.signOut() } }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
