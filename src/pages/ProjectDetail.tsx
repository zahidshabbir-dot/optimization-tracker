import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteEntry, deleteProject, updateEntry, updateProject, useTracker } from '../lib/data'
import { fmtDate, metricDef, projectView, resolveMetric, signed, STORED_LABEL, type MetricSummary } from '../lib/metrics'
import type { Entry, MetricValue, Project } from '../lib/supabase'
import { Icon, rememberProject } from '../components/Layout'
import Modal from '../components/Modal'

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
  const [editing, setEditing] = useState(false)
  const [editEntry, setEditEntry] = useState<Entry | null>(null)
  const [exporting, setExporting] = useState(false)

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
          <div className="actions">
            <button type="button" className="btn subtle" onClick={() => setEditing(true)}>Edit project</button>
            <button type="button" className="btn subtle" disabled={exporting} onClick={async () => {
              setExporting(true)
              try { await (await import('../lib/sheet')).exportXlsx([project], pValues, `${project.name.replace(/[^\w-]+/g, '-')}-data.xlsx`) } finally { setExporting(false) }
            }}>{exporting ? 'Exporting…' : 'Export Excel'}</button>
            <Link className="btn subtle" to={`/projects/${project.id}/report`}>Client report</Link>
            <Link className="btn" to={`/add?project=${project.id}`}>Add data</Link>
          </div>
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
          <div style={{ minWidth: 720 }}>
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
                  <div className="row-actions">
                    <button type="button" className="icon-btn" aria-label={`Edit ${e.title} on ${fmtDate(e.entry_date)}`} onClick={() => setEditEntry(e)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" /></svg>
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Delete ${e.title} on ${fmtDate(e.entry_date)}`} onClick={async () => {
                      if (!window.confirm(`Delete “${e.title}” (${fmtDate(e.entry_date)}) and its numbers? This can't be undone.`)) return
                      try { await deleteEntry(e.id) } catch (err) { window.alert((err as Error).message) }
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <Modal title="Edit project" open={editing} onClose={() => setEditing(false)}>
        {editing && <EditProjectForm project={project} onDone={() => setEditing(false)} />}
      </Modal>
      <Modal title="Edit entry" open={!!editEntry} onClose={() => setEditEntry(null)}>
        {editEntry && <EditEntryForm entry={editEntry} values={valuesByEntry.get(editEntry.id) ?? []} onDone={() => setEditEntry(null)} />}
      </Modal>
    </div>
  )
}

function EditProjectForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const navigate = useNavigate()
  const [f, setF] = useState({ name: project.name, platform: project.platform, store_url: project.store_url ?? '', onboarded_on: project.onboarded_on, first_change_on: project.first_change_on ?? '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr(null)
    if (!f.name.trim()) return setErr('Client name is required.')
    setBusy(true)
    try {
      await updateProject(project.id, { name: f.name.trim(), platform: f.platform, store_url: f.store_url.trim() || null, onboarded_on: f.onboarded_on, first_change_on: f.first_change_on || null })
      onDone()
    } catch (e2) { setErr((e2 as Error).message); setBusy(false) }
  }
  const remove = async () => {
    setBusy(true); setErr(null)
    try { await deleteProject(project.id); navigate('/') } catch (e2) { setErr((e2 as Error).message); setBusy(false) }
  }

  return (
    <form className="form" onSubmit={save}>
      <div className="fgrid">
        <div className="field"><label htmlFor="ep-name">Client name</label><input id="ep-name" required value={f.name} onChange={set('name')} /></div>
        <div className="field"><label htmlFor="ep-plat">Platform</label>
          <select id="ep-plat" value={f.platform} onChange={set('platform')}>
            {[...new Set(['Shopify', 'Shopify Plus', 'Other', f.platform])].map((o) => <option key={o}>{o}</option>)}
          </select></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="ep-url">Store link</label><input id="ep-url" type="url" placeholder="https://" value={f.store_url} onChange={set('store_url')} /></div>
        <div className="field"><label htmlFor="ep-on">Onboarding date</label><input id="ep-on" type="date" required value={f.onboarded_on} onChange={set('onboarded_on')} /></div>
        <div className="field"><label htmlFor="ep-fc">First change live <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label><input id="ep-fc" type="date" value={f.first_change_on} onChange={set('first_change_on')} /></div>
      </div>
      {err && <div className="notice err" role="alert">{err}</div>}
      <div className="actions"><button type="submit" className="btn lg" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className="btn subtle lg" onClick={onDone}>Cancel</button></div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="label" style={{ color: 'var(--err)' }}>Delete project</div>
        <div className="small">Removes the project and all its history and numbers for everyone. Type <b>{project.name}</b> to confirm.</div>
        <div className="actions">
          <label htmlFor="ep-del" className="sr">Type the project name to confirm</label>
          <input id="ep-del" value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} style={{ maxWidth: 280 }} />
          <button type="button" className="btn danger" disabled={busy || confirmDelete.trim() !== project.name} onClick={remove}>Delete project</button>
        </div>
      </div>
    </form>
  )
}

type Row = { label: string; phase: 'before' | 'after'; value: string }

function EditEntryForm({ entry, values, onDone }: { entry: Entry; values: MetricValue[]; onDone: () => void }) {
  const [date, setDate] = useState(entry.entry_date)
  const [title, setTitle] = useState(entry.title)
  const [note, setNote] = useState(entry.note ?? '')
  const [rows, setRows] = useState<Row[]>(values.map((v) => ({ label: STORED_LABEL[v.metric_key] ?? v.metric_label, phase: v.phase, value: String(v.value) })))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const upd = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const known = ['Conversion rate', 'Average order value', 'Revenue per visitor', 'Mobile speed', 'Desktop speed', 'Load time (LCP)']

  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr(null)
    if (!title.trim()) return setErr('Title is required.')
    const out = []
    for (const r of rows) {
      if (!r.label.trim()) return setErr('Each number needs a metric name.')
      const n = Number(r.value)
      if (r.value.trim() === '' || !isFinite(n)) return setErr(`${r.label}: “${r.value}” is not a number.`)
      const m = resolveMetric(r.label)
      out.push({ metric_key: m.key, metric_label: m.label, phase: r.phase, value: n })
    }
    setBusy(true)
    try { await updateEntry(entry.id, { date, title: title.trim(), note, values: out }); onDone() }
    catch (e2) { setErr((e2 as Error).message); setBusy(false) }
  }

  return (
    <form className="form" onSubmit={save}>
      <div className="fgrid">
        <div className="field"><label htmlFor="ee-date">Date</label><input id="ee-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="ee-title">Title</label><input id="ee-title" required value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="ee-note">Note</label><textarea id="ee-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="label">Numbers</div>
        <datalist id="metric-names">{known.map((k) => <option key={k} value={k} />)}</datalist>
        {rows.length === 0 && <div className="small">No numbers on this entry.</div>}
        {rows.map((r, i) => (
          <div className="vrow" key={i}>
            <input aria-label="Metric" list="metric-names" value={r.label} onChange={(e) => upd(i, { label: e.target.value })} />
            <select aria-label="Before or after" value={r.phase} onChange={(e) => upd(i, { phase: e.target.value as Row['phase'] })}><option value="before">Before</option><option value="after">After</option></select>
            <input aria-label={`${r.label} value`} type="number" step="any" inputMode="decimal" value={r.value} onChange={(e) => upd(i, { value: e.target.value })} placeholder={metricDef(resolveMetric(r.label || '?').key).ph} />
            <button type="button" className="icon-btn" aria-label={`Remove ${r.label}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>{Icon.x()}</button>
          </div>
        ))}
        <div><button type="button" className="linkbtn" onClick={() => setRows([...rows, { label: '', phase: 'after', value: '' }])}>+ Add a number</button></div>
      </div>
      {err && <div className="notice err" role="alert">{err}</div>}
      <div className="actions"><button type="submit" className="btn lg" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className="btn subtle lg" onClick={onDone}>Cancel</button></div>
    </form>
  )
}
