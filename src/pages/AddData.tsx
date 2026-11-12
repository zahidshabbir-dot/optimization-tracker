import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { addEntry, createProject, useTracker, type NewValue } from '../lib/data'
import { METRICS, STORED_LABEL, metricDef, slugKey, today, type MetricDef } from '../lib/metrics'
import { fmtDate } from '../lib/metrics'
import { NEW_PROJECT, type ParseResult, type ParsedRow } from '../lib/sheet'
import { Icon } from '../components/Layout'

type Tab = 'manual' | 'excel' | 'new'
const TABS: [Tab, string][] = [['manual', 'Type it in'], ['excel', 'Upload Excel'], ['new', 'New project']]

export default function AddData() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'manual') as Tab
  const pick = (k: Tab) => {
    const next = new URLSearchParams(params)
    next.set('tab', k)
    setParams(next, { replace: true })
  }

  return (
    <div className="wrap narrow">
      <header>
        <h1>Add data</h1>
        <p className="sub">Type results in, or import an Excel sheet.</p>
      </header>
      <div className="tabs" role="tablist" aria-label="How to add data">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => pick(k)}>{label}</button>
        ))}
      </div>
      {tab === 'manual' && <ManualForm initialProject={params.get('project')} />}
      {tab === 'excel' && <ExcelImport />}
      {tab === 'new' && <NewProjectForm />}
    </div>
  )
}

/* ---------- Type it in ---------- */

type Pair = { before: string; after: string }

function ManualForm({ initialProject }: { initialProject: string | null }) {
  const { projects } = useTracker()
  const [projectId, setProjectId] = useState(initialProject ?? '')
  const [date, setDate] = useState(today())
  const [defs, setDefs] = useState<MetricDef[]>(METRICS)
  const [sel, setSel] = useState<Record<string, boolean>>({ cvr: true, aov: true, rpv: true, mobile: true })
  const [vals, setVals] = useState<Record<string, Pair>>({})
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string; projectId?: string } | null>(null)

  useEffect(() => {
    if (!projectId && projects.length) setProjectId(initialProject && projects.some((p) => p.id === initialProject) ? initialProject : projects[0].id)
  }, [projects, projectId, initialProject])

  const fields = defs.filter((d) => sel[d.key])
  const setVal = (k: string, side: keyof Pair, v: string) => setVals((s) => ({ ...s, [k]: { ...(s[k] ?? { before: '', after: '' }), [side]: v } }))

  const addCustom = () => {
    const name = custom.trim()
    if (!name) return
    const key = slugKey(name)
    if (!defs.some((d) => d.key === key)) setDefs((d) => [...d, metricDef(key, name)])
    setSel((s) => ({ ...s, [key]: true }))
    setCustom('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (!projectId) return setMsg({ kind: 'err', text: 'Pick a project first.' })
    const out: NewValue[] = []
    for (const d of fields) {
      for (const phase of ['before', 'after'] as const) {
        const raw = vals[d.key]?.[phase]?.trim()
        if (!raw) continue
        const n = Number(raw)
        if (!isFinite(n)) return setMsg({ kind: 'err', text: `${d.label}: "${raw}" is not a number.` })
        out.push({ metric_key: d.key, metric_label: STORED_LABEL[d.key] ?? d.label, phase, value: n })
      }
    }
    if (!out.length) return setMsg({ kind: 'err', text: 'Enter at least one number.' })
    setBusy(true)
    try {
      const names = [...new Set(out.map((v) => metricDef(v.metric_key, v.metric_label).short))]
      const firstLine = note.trim().split('\n')[0]
      await addEntry({
        projectId,
        date,
        title: firstLine && firstLine.length <= 60 ? firstLine : `${names.slice(0, 3).join(', ')}${names.length > 3 ? ' and more' : ''} updated`,
        note: firstLine && firstLine.length <= 60 ? note.trim().split('\n').slice(1).join(' ').trim() || names.join(', ') : note.trim() || names.join(', '),
        source: 'Manual',
        values: out,
      })
      setVals({})
      setNote('')
      setMsg({ kind: 'ok', text: `Saved ${out.length} value${out.length > 1 ? 's' : ''}.`, projectId })
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!projects.length)
    return <div className="card form"><div>No projects yet. <Link to="/add?tab=new">Create a project</Link> first.</div></div>

  return (
    <form className="card form" onSubmit={submit}>
      <div className="fgrid">
        <div className="field">
          <label htmlFor="proj">Project</label>
          <select id="proj" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {fields.length > 0 && (
        <div className="table-scroll">
          <div className="ba-grid">
            <div /><div className="k">Before</div><div className="k">After</div><div />
            {fields.map((f) => (
              <FieldRow key={f.key} f={f} v={vals[f.key]} onChange={setVal} onRemove={() => setSel((s) => ({ ...s, [f.key]: false }))} />
            ))}
          </div>
        </div>
      )}

      <button type="button" className="add-metric" aria-expanded={open} onClick={() => setOpen(!open)}>
        {Icon.plus()}<span>{open ? 'Done' : 'Tap to add a metric (CVR, AOV, RPV, speed or your own)'}</span>
      </button>

      {open && (
        <div className="panel">
          <div className="label">Choose metrics <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· tap to add or remove</span></div>
          <div className="chips">
            {defs.map((d) => (
              <button key={d.key} type="button" aria-pressed={!!sel[d.key]} className={'chip' + (sel[d.key] ? ' on' : '')} onClick={() => setSel((s) => ({ ...s, [d.key]: !s[d.key] }))}>
                {sel[d.key] ? '✓ ' : ''}{d.short}
              </button>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label htmlFor="custom" className="sr">Custom metric name</label>
              <input
                id="custom" className="chip-input" type="text" placeholder="Your own metric, e.g. Bounce rate" value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
              />
              <button type="button" className="chip on" onClick={addCustom} disabled={!custom.trim()}>+ Add</button>
            </span>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="note">Note <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
        <textarea id="note" rows={3} placeholder="What changed on the store?" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {msg && (
        <div className={'notice ' + msg.kind} role="status">
          {msg.text} {msg.projectId && <Link to={`/projects/${msg.projectId}`}>View project</Link>}
        </div>
      )}
      <div><button type="submit" className="btn lg" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
    </form>
  )
}

function FieldRow({ f, v, onChange, onRemove }: { f: MetricDef; v?: Pair; onChange: (k: string, side: keyof Pair, val: string) => void; onRemove: () => void }) {
  return (
    <>
      <label htmlFor={f.key + 'B'}>{f.label} {f.unit && <span style={{ fontWeight: 400, color: 'var(--muted)' }}>{f.unit}</span>}</label>
      <input id={f.key + 'B'} type="number" step="any" inputMode="decimal" placeholder={f.ph} aria-label={`${f.label} before`} value={v?.before ?? ''} onChange={(e) => onChange(f.key, 'before', e.target.value)} />
      <input id={f.key + 'A'} type="number" step="any" inputMode="decimal" placeholder={f.ph} aria-label={`${f.label} after`} value={v?.after ?? ''} onChange={(e) => onChange(f.key, 'after', e.target.value)} />
      <button type="button" className="icon-btn" aria-label={`Remove ${f.label}`} onClick={onRemove}>{Icon.x()}</button>
    </>
  )
}

/* ---------- Upload Excel ---------- */

function ExcelImport() {
  const { projects } = useTracker()
  const [over, setOver] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [createNew, setCreateNew] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const rows = parsed?.rows ?? null

  const handle = async (file: File | undefined) => {
    if (!file) return
    setErr(null); setDone(null); setParsed(null); setShowAll(false); setCreateNew(true); setFileName(file.name)
    try {
      const { parseFile } = await import('../lib/sheet')
      const res = await parseFile(file, projects)
      if (!res.rows.length) setErr('No data rows found in this file.')
      else setParsed(res)
    } catch (e) {
      setErr((e as Error).message)
    }
    if (input.current) input.current.value = ''
  }

  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files?.[0]) }

  const isOk = (r: ParsedRow) => !r.problem || (r.problem === NEW_PROJECT && createNew)
  const good = useMemo(() => rows?.filter(isOk) ?? [], [rows, createNew]) // eslint-disable-line react-hooks/exhaustive-deps
  const bad = (rows?.length ?? 0) - good.length
  const newCount = parsed?.newProjects.length ?? 0

  const importRows = async () => {
    if (!good.length || !parsed) return
    setBusy(true); setErr(null)
    let ok = 0
    let created = 0
    try {
      // 1. create projects that aren't in the dashboard yet
      const ids = new Map(projects.map((p) => [p.name.trim().toLowerCase(), p.id]))
      if (createNew) {
        for (const plan of parsed.newProjects) {
          const k = plan.name.toLowerCase()
          if (ids.has(k)) continue
          const id = await createProject({ name: plan.name, platform: 'Shopify', storeUrl: plan.storeUrl, onboarded: plan.onboarded ?? today(), values: [] })
          ids.set(k, id); created++
        }
      }
      // 2. one history entry per project + date
      const groups = new Map<string, (ParsedRow & { pid: string })[]>()
      for (const r of good) {
        const pid = r.projectId ?? ids.get(r.projectName.toLowerCase())
        if (!pid) continue
        const k = pid + '|' + r.date
        groups.set(k, [...(groups.get(k) ?? []), { ...r, pid }])
      }
      for (const g of groups.values()) {
        const notes = [...new Set(g.map((r) => r.note).filter(Boolean))]
        const labels = [...new Set(g.map((r) => r.metricLabel))]
        await addEntry({
          projectId: g[0].pid,
          date: g[0].date!,
          title: `Imported from ${fileName}`,
          note: (notes.length ? notes.join(' | ') : labels.join(', ')).slice(0, 2000),
          source: 'Excel',
          values: g.map((r) => ({ metric_key: r.metricKey, metric_label: r.metricLabel, phase: r.phase!, value: r.value! })),
        })
        ok += g.length
      }
      const pc = new Set([...groups.values()].map((g) => g[0].pid)).size
      setDone(`Imported ${ok} value${ok === 1 ? '' : 's'} into ${pc} project${pc === 1 ? '' : 's'}${created ? ` (${created} new project${created === 1 ? '' : 's'} created)` : ''}.`)
      setParsed(null)
    } catch (e) {
      setErr(`Stopped after ${ok} values${created ? ` and ${created} new projects` : ''}: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const visible = showAll ? rows ?? [] : (rows ?? []).slice(0, 5)

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div
        className={'drop' + (over ? ' over' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {Icon.upload('#1559E6', 40, 1.8)}
        <div className="t">Drop your Excel or CSV file here</div>
        <div className="d">.xlsx or .csv · a simple list (Project, Date, Metric, Before/After, Value) or a sheet with Before / After / Current columns</div>
        <label htmlFor="file" className="btn" style={{ marginTop: 8 }}>Choose file</label>
        <input ref={input} id="file" type="file" accept=".xlsx,.xls,.csv" className="sr" onChange={(e) => handle(e.target.files?.[0])} />
        <button type="button" className="linkbtn" style={{ marginTop: 6 }} onClick={async () => (await import('../lib/sheet')).downloadTemplate(projects)}>Download the template</button>
      </div>

      {err && <div className="notice err" role="alert">{err}</div>}
      {done && <div className="notice ok" role="status">{done} <Link to="/">See projects</Link></div>}

      {rows && parsed && (
        <div className="card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{fileName}</div>
              <div className="small">Read from sheet “{parsed.sheet}”</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: bad ? 'var(--warn)' : 'var(--good)' }}>
              {rows.length} values found · {bad ? `${bad} will be skipped` : 'all ready to import'}
            </div>
          </div>

          {newCount > 0 && (
            <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: 'var(--blue-wash)', borderRadius: 12, padding: '14px 16px', cursor: 'pointer' }}>
              <input type="checkbox" checked={createNew} onChange={(e) => setCreateNew(e.target.checked)} style={{ width: 20, height: 20, marginTop: 2, accentColor: 'var(--blue)' }} />
              <span>
                <b>Create {newCount} new project{newCount === 1 ? '' : 's'}</b> that {newCount === 1 ? 'is' : 'are'} not in the dashboard yet
                <span className="small" style={{ display: 'block', marginTop: 4 }}>{parsed.newProjects.map((p) => p.name).join(', ')}</span>
              </span>
            </label>
          )}

          <div className="table-scroll">
            <table className="preview">
              <thead><tr><th>Project</th><th>Date</th><th>Metric</th><th>Before / after</th><th>Value</th><th>Check</th></tr></thead>
              <tbody>
                {visible.map((r, i) => {
                  const ok = isOk(r)
                  return (
                    <tr key={i} className={ok ? '' : 'bad'}>
                      <td style={{ fontWeight: 500 }}>{r.projectName || '—'}</td>
                      <td style={{ color: 'var(--ink-2)' }}>{r.date ? fmtDate(r.date) : '—'}</td>
                      <td>{r.metricLabel}</td>
                      <td style={{ color: 'var(--ink-2)' }}>{r.note.split(':')[0] || (r.phase === 'before' ? 'Before' : r.phase === 'after' ? 'After' : '—')}</td>
                      <td style={{ fontWeight: 500 }}>{r.value ?? '—'}</td>
                      <td style={{ fontSize: 13, color: ok ? 'var(--good)' : 'var(--err)' }}>
                        {ok ? (r.problem === NEW_PROJECT ? 'OK · new project' : 'OK') : `Row ${r.line}: ${r.problem}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="small" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            Showing {visible.length} of {rows.length}
            {rows.length > 5 && <button type="button" className="linkbtn" style={{ fontSize: 13 }} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less' : 'Show all'}</button>}
          </div>
          {bad > 0 && <div className="notice warn">Rows marked in red will be skipped (for example a value with no date). Fix them in the file and upload again, or add them under “Type it in”.</div>}
          <div><button type="button" className="btn lg" disabled={!good.length || busy} onClick={importRows}>{busy ? 'Importing…' : `Import ${good.length} value${good.length === 1 ? '' : 's'}`}</button></div>
        </div>
      )}
    </section>
  )
}

/* ---------- New project ---------- */

function NewProjectForm() {
  const navigate = useNavigate()
  const { projects } = useTracker()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [on, setOn] = useState(today())
  const [platform, setPlatform] = useState('Shopify')
  const [cvr, setCvr] = useState('')
  const [mobile, setMobile] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    const n = name.trim()
    if (!n) return setErr('Client name is required.')
    if (projects.some((p) => p.name.trim().toLowerCase() === n.toLowerCase())) return setErr(`A project called “${n}” already exists.`)
    const values: NewValue[] = []
    if (cvr.trim()) values.push({ metric_key: 'cvr', metric_label: STORED_LABEL.cvr, phase: 'before', value: Number(cvr) })
    if (mobile.trim()) values.push({ metric_key: 'mobile', metric_label: STORED_LABEL.mobile, phase: 'before', value: Number(mobile) })
    if (values.some((v) => !isFinite(v.value))) return setErr('Starting numbers must be numbers.')
    setBusy(true)
    try {
      const id = await createProject({ name: n, platform, storeUrl: url, onboarded: on, values })
      navigate(`/projects/${id}`)
    } catch (e2) {
      setErr((e2 as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <div className="fgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
        <div className="field"><label htmlFor="cn">Client name</label><input id="cn" type="text" required placeholder="e.g. Aurora Skincare" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="url">Store link</label><input id="url" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
        <div className="field"><label htmlFor="on">Onboarding date</label><input id="on" type="date" required value={on} onChange={(e) => setOn(e.target.value)} /></div>
        <div className="field"><label htmlFor="plat">Platform</label>
          <select id="plat" value={platform} onChange={(e) => setPlatform(e.target.value)}><option>Shopify</option><option>Shopify Plus</option><option>Other</option></select>
        </div>
      </div>
      <div>
        <div className="label" style={{ marginBottom: 10 }}>Starting numbers <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional, add later if you prefer)</span></div>
        <div className="fgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
          <div className="field"><label htmlFor="b1">Conversion rate (%)</label><input id="b1" type="number" step="any" placeholder="1.8" value={cvr} onChange={(e) => setCvr(e.target.value)} /></div>
          <div className="field"><label htmlFor="b2">Mobile speed score</label><input id="b2" type="number" step="any" min={0} max={100} placeholder="38" value={mobile} onChange={(e) => setMobile(e.target.value)} /></div>
        </div>
      </div>
      {err && <div className="notice err" role="alert">{err}</div>}
      <div><button type="submit" className="btn lg" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button></div>
    </form>
  )
}
