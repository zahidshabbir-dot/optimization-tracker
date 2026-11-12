import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTracker } from '../lib/data'
import { fmtDate, projectView, signed, type MetricSummary } from '../lib/metrics'
import type { MetricValue } from '../lib/supabase'
import { Icon, rememberProject } from '../components/Layout'

const HIST_SHORT: Record<string, string> = { cvr: 'CVR', aov: 'AOV', rpv: 'RPV', mobile: 'Mobile', desktop: 'Desktop', lcp: 'LCP' }
const CORE = ['cvr', 'mobile', 'desktop', 'lcp', 'aov', 'rpv']

function liftPill(s: MetricSummary | undefined, suffix = '') {
  if (!s || s.lift == null) return <div className="pill none">Waiting for data</div>
  return <div className={'pill ' + (s.lift >= 0 ? 'good' : 'warn')}>{signed(s.lift)}%{suffix}</div>
}

function Pair({ s }: { s: MetricSummary | undefined }) {
  if (!s) return <b>—</b>
  return <b>{s.before != null ? s.def.format(s.before) : '—'} → {s.after != null ? s.def.format(s.after) : '—'}</b>
}

function InlineCard({ title, abbr, s }: { title: string; abbr?: string; s: MetricSummary | undefined }) {
  return (
    <div className="card mcard sm">
      <div className="mtitle">{title} {abbr && <span>· {abbr}</span>}</div>
      <div className="inline-ba">
        <span className="b">{s?.before != null ? s.def.format(s.before) : '—'}</span>
        <span style={{ color: 'var(--faint)' }}>→</span>
        <span className="a">{s?.after != null ? s.def.format(s.after) : '—'}</span>
        {s?.lift != null && (
          <span style={{ fontSize: 14, fontWeight: 500, color: s.lift >= 0 ? 'var(--good)' : 'var(--warn)' }}>{signed(s.lift)}%</span>
        )}
      </div>
    </div>
  )
}

export default function ProjectDetail() {
  const { id = '' } = useParams()
  const { projects, values, entries, loading } = useTracker()
  const project = projects.find((p) => p.id === id)

  useEffect(() => { if (project) rememberProject(project.id) }, [project])

  const pValues = useMemo(() => values.filter((v) => v.project_id === id), [values, id])
  const pEntries = useMemo(() => entries.filter((e) => e.project_id === id), [entries, id])

  // Briefly highlight history rows that arrive while the page is open.
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (loading) return
    const ids = new Set(pEntries.map((e) => e.id))
    if (seen.current) {
      const added = [...ids].filter((x) => !seen.current!.has(x))
      if (added.length) {
        setFresh(new Set(added))
        const t = setTimeout(() => setFresh(new Set()), 1300)
        seen.current = ids
        return () => clearTimeout(t)
      }
    }
    seen.current = ids
  }, [pEntries, loading])

  if (loading) return <div className="wrap"><div className="skeleton" style={{ width: 240, height: 36 }} /></div>
  if (!project)
    return (
      <div className="wrap">
        <Link className="back" to="/">{Icon.back()}Projects</Link>
        <h1>Project not found</h1>
        <p className="sub">It may have been removed. Pick one from the projects list.</p>
      </div>
    )

  const view = projectView(project, pValues, pEntries)
  const s = view.sums
  const extras = [...s.values()].filter((m) => !CORE.includes(m.key))

  const valuesByEntry = new Map<string, MetricValue[]>()
  for (const v of pValues) if (v.entry_id) valuesByEntry.set(v.entry_id, [...(valuesByEntry.get(v.entry_id) ?? []), v])

  const changeText = (entryVals: MetricValue[]) => {
    if (!entryVals.length) return { main: '—', more: 0 }
    const primary = entryVals.find((v) => v.metric_key === 'cvr' && v.phase === 'after') ?? entryVals.find((v) => v.metric_key === 'cvr') ?? entryVals[0]
    const def = s.get(primary.metric_key)?.def
    const fmt = (n: number) => (def ? def.format(n) : String(n))
    const short = HIST_SHORT[primary.metric_key] ?? primary.metric_label
    let main = `${short} ${fmt(primary.value)}`
    if (primary.metric_key !== 'cvr' && primary.phase === 'after') {
      const prev = pValues
        .filter((v) => v.metric_key === primary.metric_key && v.id !== primary.id && (v.recorded_on < primary.recorded_on || (v.recorded_on === primary.recorded_on && v.created_at < primary.created_at)))
        .sort((a, b) => a.recorded_on.localeCompare(b.recorded_on) || a.created_at.localeCompare(b.created_at))
        .at(-1)
      if (prev) main = `${short} ${fmt(prev.value)} → ${fmt(primary.value)}`
    }
    return { main, more: entryVals.length - 1 }
  }

  return (
    <div className="wrap" style={{ gap: 32 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Link className="back" to="/">{Icon.back()}Projects</Link>
        <div className="page-head" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1>{project.name}</h1>
            <p className="sub">
              {project.platform}
              {project.store_url && <> · <a href={project.store_url} target="_blank" rel="noreferrer">{project.store_url.replace(/^https?:\/\//, '')}</a></>}
            </p>
          </div>
          <Link className="btn" to={`/add?project=${project.id}`}>Add data</Link>
        </div>
      </header>

      <section aria-label="Key dates" className="card dates">
        <div><div className="k">Onboarded</div><div className="v">{fmtDate(project.onboarded_on)}</div></div>
        <div><div className="k">First change live</div><div className="v">{fmtDate(view.firstChange)}</div></div>
        <div><div className="k">Last data added</div><div className="v">{fmtDate(view.lastData)}</div></div>
      </section>

      <section aria-label="Before and after" className="cards2">
        <div className="card mcard">
          <div className="mtitle">Conversion rate</div>
          <div className="ba">
            <div><div className="k">Before</div><div className="before-v">{s.get('cvr')?.before != null ? s.get('cvr')!.def.format(s.get('cvr')!.before!) : '—'}</div></div>
            <div><div className="k">After</div><div className="after-v">{s.get('cvr')?.after != null ? s.get('cvr')!.def.format(s.get('cvr')!.after!) : '—'}</div></div>
          </div>
          {liftPill(s.get('cvr'), ' since onboarding')}
        </div>

        <div className="card mcard">
          <div className="mtitle">Page speed <span>· score out of 100</span></div>
          <div className="ba">
            <div><div className="k">Before</div><div className="before-v">{s.get('mobile')?.before != null ? s.get('mobile')!.def.format(s.get('mobile')!.before!) : '—'}</div></div>
            <div><div className="k">After (mobile)</div><div className="after-v">{s.get('mobile')?.after != null ? s.get('mobile')!.def.format(s.get('mobile')!.after!) : '—'}</div></div>
          </div>
          <div className="subline">
            <span>Desktop <Pair s={s.get('desktop')} /></span>
            <span>Load time (LCP) <Pair s={s.get('lcp')} /></span>
          </div>
        </div>
      </section>

      <section aria-label="Revenue metrics" className="cards2">
        <InlineCard title="Average order value" abbr="AOV" s={s.get('aov')} />
        <InlineCard title="Revenue per visitor" abbr="RPV" s={s.get('rpv')} />
        {extras.map((m) => <InlineCard key={m.key} title={m.label} s={m} />)}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2>History</h2>
        <div className="card table-scroll">
          <div style={{ minWidth: 640 }}>
            {pEntries.length === 0 && <div className="empty">No history yet.</div>}
            {pEntries.map((e) => {
              const c = changeText(valuesByEntry.get(e.id) ?? [])
              return (
                <div key={e.id} className={'hist' + (fresh.has(e.id) ? ' flash' : '')}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--muted)' }}>{fmtDate(e.entry_date)}</div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{e.title}</div>
                    {e.note && <div className="small" style={{ marginTop: 2 }}>{e.note}</div>}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>
                    {c.main}
                    {c.more > 0 && <div className="small" style={{ fontWeight: 400 }}>+{c.more} more</div>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)', textAlign: 'right' }}>{e.source}</div>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
