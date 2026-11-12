import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTracker } from '../lib/data'
import { fmtDate, projectView, signed, STATUS_DOT, type Status } from '../lib/metrics'
import { Icon } from '../components/Layout'

type Filter = 'All' | Status
const FILTERS: Filter[] = ['All', 'Improving', 'Needs attention', 'Onboarding']

export default function Projects() {
  const { projects, values, entries, loading, error } = useTracker()
  const [filter, setFilter] = useState<Filter>('All')
  const [q, setQ] = useState('')

  const rows = useMemo(
    () => projects.map((p) => projectView(p, values.filter((v) => v.project_id === p.id), entries.filter((e) => e.project_id === p.id))),
    [projects, values, entries],
  )

  const withLift = rows.filter((r) => r.sums.get('cvr')?.lift != null)
  const avgLift = withLift.length ? withLift.reduce((a, r) => a + (r.sums.get('cvr')!.lift as number), 0) / withLift.length : null
  const summary = `${rows.length} client${rows.length === 1 ? '' : 's'}` + (avgLift !== null ? ` · average conversion lift ${signed(avgLift)}%` : '')

  const needle = q.trim().toLowerCase()
  const shown = rows.filter(
    (r) => (filter === 'All' || r.status === filter) && (!needle || r.project.name.toLowerCase().includes(needle) || r.project.platform.toLowerCase().includes(needle)),
  )

  return (
    <div className="wrap">
      <header className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="sub">{loading ? 'Loading…' : summary}</p>
        </div>
        <div className="actions">
          <label className="search">
            <span className="sr">Search projects</span>
            {Icon.search()}
            <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <Link className="btn" to="/add">Add data</Link>
        </div>
      </header>

      {error && <div className="notice err">Couldn't load data: {error}</div>}

      <div className="tabs" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} className={'tab' + (filter === f ? ' on' : '')} onClick={() => setFilter(f)}>
            {f} <span className="count">{f === 'All' ? rows.length : rows.filter((r) => r.status === f).length}</span>
          </button>
        ))}
      </div>

      <section className="card table-scroll" aria-label="Project list">
        <div style={{ minWidth: 780 }}>
          <div className="grid-row head">
            <div>Client</div><div>Onboarded</div><div>Conversion rate</div><div>Mobile speed</div><div>Status</div><div />
          </div>
          {loading &&
            [0, 1, 2, 3].map((i) => (
              <div key={i} className="grid-row"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /><div /></div>
            ))}
          {!loading && shown.length === 0 && (
            <div className="empty">
              {rows.length === 0 ? <>No projects yet. <Link to="/add?tab=new">Create the first one</Link>.</> : 'No projects match.'}
            </div>
          )}
          {shown.map((r) => {
            const cvr = r.sums.get('cvr')
            const sp = r.sums.get('mobile')
            const deltaColor = (lift: number | null | undefined) =>
              lift == null ? 'var(--muted)' : lift >= 15 ? 'var(--good)' : 'var(--warn)'
            return (
              <Link key={r.project.id} className="grid-row" to={`/projects/${r.project.id}`}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 500 }}>{r.project.name}</div>
                  <div className="small" style={{ marginTop: 2 }}>{r.project.platform}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-2)' }}>{fmtDate(r.project.onboarded_on)}</div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>
                    <span style={{ color: 'var(--muted)' }}>{cvr?.before != null ? cvr.def.format(cvr.before) : '—'}</span> → <b style={{ fontWeight: 600 }}>{cvr?.after != null ? cvr.def.format(cvr.after) : '—'}</b>
                  </div>
                  <div style={{ marginTop: 2, fontSize: 13, fontWeight: 500, color: deltaColor(cvr?.lift) }}>
                    {cvr?.lift != null ? `${signed(cvr.lift)}%` : 'Waiting for data'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>
                    <span style={{ color: 'var(--muted)' }}>{sp?.before != null ? sp.def.format(sp.before) : '—'}</span> → <b style={{ fontWeight: 600 }}>{sp?.after != null ? sp.def.format(sp.after) : '—'}</b>
                  </div>
                  <div style={{ marginTop: 2, fontSize: 13, fontWeight: 500, color: deltaColor(cvr?.lift) }}>
                    {sp?.before != null && sp.after != null ? `${signed(sp.after - sp.before)} points` : 'Waiting for data'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 }}>
                  <span className="dot" style={{ background: STATUS_DOT[r.status] }} />{r.status}
                </div>
                {Icon.chevron()}
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
