import { Link, useParams } from 'react-router-dom'
import { useTracker } from '../lib/data'
import { fmtDate, projectView, signed, STORED_LABEL } from '../lib/metrics'
import { Icon } from '../components/Layout'
import Screenshots from '../components/Screenshots'

const ORDER = ['cvr', 'aov', 'rpv', 'mobile', 'desktop', 'lcp']

/** Printable one-page summary to send to the client (Print → Save as PDF). */
export default function Report() {
  const { id = '' } = useParams()
  const { projects, values, entries, attachments, loading } = useTracker()
  const project = projects.find((p) => p.id === id)
  if (loading) return null
  if (!project) return <div style={{ padding: 40 }}>Project not found. <Link to="/">Back to projects</Link></div>

  const pValues = values.filter((v) => v.project_id === id)
  const pEntries = entries.filter((e) => e.project_id === id)
  const view = projectView(project, pValues, pEntries)
  const sums = [...view.sums.values()].sort((a, b) => {
    const ia = ORDER.indexOf(a.key), ib = ORDER.indexOf(b.key)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.label.localeCompare(b.label)
  })
  const cvr = view.sums.get('cvr')

  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <div className="no-print" style={{ position: 'sticky', top: 0, background: '#FBFCFE', borderBottom: '1px solid var(--line)', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', zIndex: 1 }}>
        <Link className="back" to={`/projects/${id}`}>{Icon.back()}Back to {project.name}</Link>
        <button type="button" className="btn" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <article style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px 56px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', borderBottom: '2px solid var(--ink)', paddingBottom: 18 }}>
          <div>
            <div className="small" style={{ fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>Optimization results</div>
            <h1 style={{ marginTop: 6 }}>{project.name}</h1>
            <p className="sub">{project.platform}{project.store_url ? ` · ${project.store_url.replace(/^https?:\/\//, '')}` : ''}</p>
          </div>
          <div className="small" style={{ textAlign: 'right' }}>Prepared {fmtDate(new Date().toISOString().slice(0, 10))}</div>
        </header>

        <section className="dates" style={{ padding: 0 }}>
          <div><div className="k">Onboarded</div><div className="v">{fmtDate(project.onboarded_on)}</div></div>
          <div><div className="k">First change live</div><div className="v">{fmtDate(view.firstChange)}</div></div>
          <div><div className="k">Latest results</div><div className="v">{fmtDate(view.lastData)}</div></div>
        </section>

        {cvr?.lift != null && (
          <section style={{ background: 'var(--blue-wash)', borderRadius: 16, padding: '22px 26px' }}>
            <div className="k">Conversion rate</div>
            <div style={{ fontSize: 34, fontWeight: 600, marginTop: 4 }}>
              {cvr.def.format(cvr.before!)} <span style={{ color: 'var(--faint)' }}>→</span> <span style={{ color: 'var(--blue)' }}>{cvr.def.format(cvr.after!)}</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 15, fontWeight: 600, color: cvr.lift >= 0 ? 'var(--good)' : 'var(--warn)' }}>{signed(cvr.lift)}% since onboarding</div>
          </section>
        )}

        <section>
          <h2 style={{ marginBottom: 12 }}>Before and after</h2>
          <table className="preview" style={{ minWidth: 0 }}>
            <thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Change</th></tr></thead>
            <tbody>
              {sums.map((m) => (
                <tr key={m.key}>
                  <td style={{ fontWeight: 500 }}>{STORED_LABEL[m.key] ?? m.label}</td>
                  <td>{m.before != null ? m.def.format(m.before) : '—'}</td>
                  <td style={{ fontWeight: 600 }}>{m.after != null ? m.def.format(m.after) : '—'}</td>
                  <td style={{ color: m.lift == null ? 'var(--muted)' : m.lift >= 0 ? 'var(--good)' : 'var(--warn)', fontWeight: 500 }}>
                    {m.lift != null ? `${signed(m.lift)}%${m.def.lowerIsBetter ? ' (faster)' : ''}` : 'Pending'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <Screenshots projectId={id} items={attachments.filter((a) => a.project_id === id)} readOnly />

        <section>
          <h2 style={{ marginBottom: 12 }}>What we changed</h2>
          <table className="preview" style={{ minWidth: 0 }}>
            <tbody>
              {pEntries.map((e) => (
                <tr key={e.id}>
                  <td style={{ width: 130, color: 'var(--muted)' }}>{fmtDate(e.entry_date)}</td>
                  <td><div style={{ fontWeight: 500 }}>{e.title}</div>{e.note && <div className="small">{e.note}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </article>
    </div>
  )
}
