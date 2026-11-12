import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTracker } from '../lib/data'
import { useAuth } from '../lib/auth'

export const Icon = {
  grid: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
  ),
  folder: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
  ),
  upload: (c = 'currentColor', s = 18, w = 2) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
  ),
  chevron: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA7C7" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
  ),
  back: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
  ),
  plus: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
  ),
  x: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  search: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7798" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
  ),
}

const LAST_KEY = 'ot:lastProject'
export function rememberProject(id: string) {
  try { localStorage.setItem(LAST_KEY, id) } catch { /* storage unavailable */ }
}
function lastProject() {
  try { return localStorage.getItem(LAST_KEY) } catch { return null }
}

export default function Layout() {
  const { live, projects } = useTracker()
  const { email, signOut, loginEnabled } = useAuth()
  const loc = useLocation()
  const last = lastProject()
  const detailId = (last && projects.some((p) => p.id === last) ? last : projects[0]?.id) ?? ''
  const onDetail = loc.pathname.startsWith('/projects/')

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
          </div>
          <div>Optimization<br />Tracker</div>
        </div>
        <nav className="nav" aria-label="Main">
          <NavLink end to="/" className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>{Icon.grid()}Projects</NavLink>
          <NavLink to={detailId ? `/projects/${detailId}` : '/'} className={'navlink' + (onDetail ? ' active' : '')}>{Icon.folder()}Project detail</NavLink>
          <NavLink to="/add" className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>{Icon.upload()}Add data</NavLink>
          {loginEnabled && (
            <NavLink to="/team" className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.2a5 5 0 0 1 5.5 4.8" /></svg>Team
            </NavLink>
          )}
        </nav>
        <div className="side-foot" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={'live-dot ' + live} />
            {live === 'live' ? 'Live · updates instantly' : live === 'offline' ? 'Offline · reconnecting' : 'Connecting…'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', maxWidth: '100%' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }} title={email ?? ''}>{email}</span>
            {email && email !== 'Local mode' && <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={signOut}>Sign out</button>}
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
