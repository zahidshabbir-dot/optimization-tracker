import { useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react'
import { addAttachment, deleteAttachment } from '../lib/data'
import { fmtDate, today } from '../lib/metrics'
import { BACKEND, type Attachment } from '../lib/supabase'
import Modal from './Modal'

const isImage = (a: Attachment) => !!a.storage_path || /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(a.url)
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }

export default function Screenshots({ projectId, items, readOnly = false }: { projectId: string; items: Attachment[]; readOnly?: boolean }) {
  const [adding, setAdding] = useState<'before' | 'after' | null>(null)
  const cols: ['before' | 'after', string][] = [['before', 'Before'], ['after', 'After']]
  if (readOnly && !items.length) return null

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }} aria-label="Screenshots">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2>Screenshots</h2>
        {!readOnly && <span className="small">PageSpeed results, analytics, or any proof link</span>}
      </div>
      <div className="cards2">
        {cols.map(([phase, label]) => {
          const list = items.filter((a) => a.phase === phase)
          return (
            <div key={phase} className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div className="mtitle">{label} <span>· {list.length}</span></div>
                {!readOnly && <button type="button" className="btn subtle" style={{ height: 38, padding: '0 16px' }} onClick={() => setAdding(phase)}>+ Add</button>}
              </div>
              {list.length === 0 && <div className="small">No {label.toLowerCase()} screenshots yet.</div>}
              <div className="shots">
                {list.map((a) => <Shot key={a.id} a={a} readOnly={readOnly} />)}
              </div>
            </div>
          )
        })}
      </div>
      <Modal title={adding === 'before' ? 'Add a before screenshot' : 'Add an after screenshot'} open={!!adding} onClose={() => setAdding(null)}>
        {adding && <AddForm projectId={projectId} phase={adding} onDone={() => setAdding(null)} />}
      </Modal>
    </section>
  )
}

function Shot({ a, readOnly }: { a: Attachment; readOnly: boolean }) {
  const [busy, setBusy] = useState(false)
  const img = isImage(a)
  return (
    <figure className="shot">
      <a href={a.url} target="_blank" rel="noreferrer" className="shot-link" aria-label={`Open ${a.label || 'screenshot'} in a new tab`}>
        {img ? <img src={a.url} alt={a.label || 'Screenshot'} loading="lazy" /> : (
          <span className="shot-url">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
            {host(a.url)}
          </span>
        )}
      </a>
      <figcaption>
        <div style={{ minWidth: 0 }}>
          <div className="shot-title">{a.label || (img ? 'Screenshot' : host(a.url))}</div>
          {a.taken_on && <div className="small">{fmtDate(a.taken_on)}</div>}
        </div>
        {!readOnly && (
          <button type="button" className="icon-btn" disabled={busy} aria-label={`Delete ${a.label || 'screenshot'}`} onClick={async () => {
            if (!window.confirm('Delete this screenshot?')) return
            setBusy(true)
            try { await deleteAttachment(a) } catch (e) { window.alert((e as Error).message); setBusy(false) }
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></svg>
          </button>
        )}
      </figcaption>
    </figure>
  )
}

function AddForm({ projectId, phase, onDone }: { projectId: string; phase: 'before' | 'after'; onDone: () => void }) {
  const canUpload = BACKEND === 'supabase'
  const [mode, setMode] = useState<'file' | 'link'>(canUpload ? 'file' : 'link')
  const [files, setFiles] = useState<File[]>([])
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [date, setDate] = useState(today())
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const take = (list: FileList | File[] | null | undefined) => {
    const imgs = [...(list ?? [])].filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return setErr('Please choose an image (PNG, JPG, WebP or GIF).')
    const big = imgs.find((f) => f.size > 10 * 1024 * 1024)
    if (big) return setErr(`${big.name} is larger than 10 MB.`)
    setErr(null); setMode('file'); setFiles((f) => [...f, ...imgs])
  }
  const onPaste = (e: ClipboardEvent) => {
    if (!canUpload) return
    const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (imgs.length) { e.preventDefault(); take(imgs) }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null)
    if (mode === 'file' && !files.length) return setErr('Choose or paste an image first.')
    if (mode === 'link' && !/^https?:\/\/\S+$/i.test(url.trim())) return setErr('Paste a full link starting with https://')
    setBusy(true)
    try {
      if (mode === 'file') {
        for (const f of files) await addAttachment({ projectId, phase, label: label || f.name.replace(/\.[^.]+$/, ''), takenOn: date, file: f })
      } else {
        await addAttachment({ projectId, phase, label, takenOn: date, url: url.trim() })
      }
      onDone()
    } catch (e2) { setErr((e2 as Error).message); setBusy(false) }
  }

  return (
    <form className="form" onSubmit={submit} onPaste={onPaste}>
      {canUpload && (
        <div className="seg" role="group" aria-label="Screenshot source">
          <button type="button" aria-pressed={mode === 'file'} onClick={() => setMode('file')}>Upload image</button>
          <button type="button" aria-pressed={mode === 'link'} onClick={() => setMode('link')}>Paste a link</button>
        </div>
      )}
      {mode === 'file' ? (
        <div
          className={'drop' + (over ? ' over' : '')} style={{ padding: '28px 20px' }}
          onDragOver={(e: DragEvent) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e: DragEvent) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
        >
          <div className="t" style={{ fontSize: 16 }}>Drop, paste (Ctrl/⌘ + V) or choose images</div>
          <label htmlFor="shot-file" className="btn" style={{ marginTop: 6 }}>Choose images</label>
          <input id="shot-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="sr" onChange={(e) => take(e.target.files)} />
          {files.length > 0 && (
            <div className="chips" style={{ justifyContent: 'center', marginTop: 8 }}>
              {files.map((f, i) => (
                <span key={i} className="chip on" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {f.name || 'Pasted image'}
                  <button type="button" className="linkbtn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="field">
          <label htmlFor="shot-url">Link</label>
          <input id="shot-url" type="url" placeholder="https://pagespeed.web.dev/analysis/…  or a Loom / Drive / Slack link" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
      )}
      <div className="fgrid">
        <div className="field"><label htmlFor="shot-label">Label <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
          <input id="shot-label" placeholder="e.g. Mobile PageSpeed" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        <div className="field"><label htmlFor="shot-date">Date taken</label>
          <input id="shot-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      {err && <div className="notice err" role="alert">{err}</div>}
      <div className="actions">
        <button type="submit" className="btn lg" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn subtle lg" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
