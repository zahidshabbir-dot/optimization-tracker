import { BACKEND, supabase, type Attachment, type Entry, type MetricValue, type Project } from './supabase'

export type Snapshot = { projects: Project[]; entries: Entry[]; values: MetricValue[]; attachments: Attachment[] }
export type AttachmentInput = { projectId: string; phase: 'before' | 'after'; label: string; takenOn: string | null; url?: string; file?: File }
export type NewValue = { metric_key: string; metric_label: string; phase: 'before' | 'after'; value: number }
export type LiveStatus = 'connecting' | 'live' | 'offline'
export type EntryInput = { projectId: string; date: string; title: string; note?: string | null; source: 'Manual' | 'Excel'; values: NewValue[] }
export type ProjectInput = { name: string; platform: string; storeUrl: string; onboarded: string; values: NewValue[] }
export type ProjectPatch = { name: string; platform: string; store_url: string | null; onboarded_on: string; first_change_on: string | null }
export type EntryPatch = { date: string; title: string; note: string; values: NewValue[] }

type Backend = {
  load(): Promise<Snapshot>
  /** Calls onChange whenever any client writes data. Returns an unsubscribe function. */
  subscribe(onChange: () => void, onStatus: (s: LiveStatus) => void): () => void
  addEntry(a: EntryInput): Promise<string>
  createProject(a: ProjectInput): Promise<string>
  updateProject(id: string, p: ProjectPatch): Promise<void>
  deleteProject(id: string): Promise<void>
  updateEntry(id: string, p: EntryPatch): Promise<void>
  deleteEntry(id: string): Promise<void>
  addAttachment(a: AttachmentInput): Promise<void>
  deleteAttachment(a: Attachment): Promise<void>
}

const friendly = (m: string) => (/projects_name_unique|duplicate key/.test(m) ? 'A project with that name already exists.' : m)

const supabaseBackend: Backend = {
  async load() {
    const [p, e, v, a] = await Promise.all([
      supabase.from('projects').select('*').order('onboarded_on', { ascending: false }),
      supabase.from('entries').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('metric_values').select('*'),
      supabase.from('attachments').select('*').order('taken_on', { ascending: true }).order('created_at', { ascending: true }),
    ])
    const err = p.error || e.error || v.error || a.error
    if (err) throw new Error(err.message)
    return { projects: p.data as Project[], entries: e.data as Entry[], values: v.data as MetricValue[], attachments: a.data as Attachment[] }
  },
  subscribe(onChange, onStatus) {
    const ch = supabase.channel('tracker-changes')
    for (const table of ['projects', 'entries', 'metric_values', 'attachments']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
    ch.subscribe((s) => {
      if (s === 'SUBSCRIBED') { onStatus('live'); onChange() }
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') onStatus('offline')
    })
    return () => { supabase.removeChannel(ch) }
  },
  async addEntry(a) {
    const { data, error } = await supabase.rpc('add_entry', { p_project: a.projectId, p_date: a.date, p_title: a.title, p_note: a.note ?? '', p_source: a.source, p_values: a.values })
    if (error) throw new Error(error.message)
    return data as string
  },
  async createProject(a) {
    const { data, error } = await supabase.rpc('create_project', { p_name: a.name, p_platform: a.platform, p_store_url: a.storeUrl, p_onboarded: a.onboarded, p_values: a.values })
    if (error) throw new Error(friendly(error.message))
    return data as string
  },
  async updateProject(id, p) {
    const { error } = await supabase.from('projects').update(p).eq('id', id)
    if (error) throw new Error(friendly(error.message))
  },
  async deleteProject(id) {
    const { data: files } = await supabase.from('attachments').select('storage_path').eq('project_id', id).not('storage_path', 'is', null)
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) throw new Error(error.message)
    const paths = (files ?? []).map((f) => f.storage_path as string)
    if (paths.length) await supabase.storage.from('screenshots').remove(paths)
  },
  async updateEntry(id, p) {
    const { error } = await supabase.rpc('update_entry', { p_entry: id, p_date: p.date, p_title: p.title, p_note: p.note, p_values: p.values })
    if (error) throw new Error(error.message)
  },
  async deleteEntry(id) {
    const { error } = await supabase.from('entries').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
  async addAttachment(a) {
    let url = a.url?.trim() ?? ''
    let storage_path: string | null = null
    if (a.file) {
      const ext = (a.file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
      storage_path = `${a.projectId}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('screenshots').upload(storage_path, a.file, { contentType: a.file.type, upsert: false })
      if (up.error) throw new Error(up.error.message)
      url = supabase.storage.from('screenshots').getPublicUrl(storage_path).data.publicUrl
    }
    const { error } = await supabase.from('attachments').insert({ project_id: a.projectId, phase: a.phase, label: a.label.trim() || null, url, storage_path, taken_on: a.takenOn || null })
    if (error) {
      if (storage_path) await supabase.storage.from('screenshots').remove([storage_path])
      throw new Error(/attachments_url_check/.test(error.message) ? 'Links must start with http:// or https://' : error.message)
    }
  },
  async deleteAttachment(a) {
    const { error } = await supabase.from('attachments').delete().eq('id', a.id)
    if (error) throw new Error(error.message)
    if (a.storage_path) await supabase.storage.from('screenshots').remove([a.storage_path])
  },
}

const API = (import.meta.env.VITE_LOCAL_API as string | undefined) ?? '/api'
async function post(path: string, body: unknown, method = 'POST') {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
  return j.id as string
}

const localBackend: Backend = {
  async load() {
    const r = await fetch(API + '/data')
    if (!r.ok) throw new Error(`Local API error (${r.status}). Is "npm run server" running?`)
    return r.json()
  },
  subscribe(onChange, onStatus) {
    const es = new EventSource(API + '/events')
    es.onopen = () => onStatus('live')
    es.onmessage = () => onChange()
    es.onerror = () => onStatus(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting')
    return () => es.close()
  },
  addEntry: (a) => post('/entries', a),
  createProject: (a) => post('/projects', a),
  updateProject: async (id, p) => { await post(`/projects/${id}`, p, 'PUT') },
  deleteProject: async (id) => { await post(`/projects/${id}`, {}, 'DELETE') },
  updateEntry: async (id, p) => { await post(`/entries/${id}`, p, 'PUT') },
  deleteEntry: async (id) => { await post(`/entries/${id}`, {}, 'DELETE') },
  addAttachment: async (a) => {
    if (a.file) throw new Error('Image uploads need the Supabase backend. Paste a link instead.')
    await post('/attachments', { project_id: a.projectId, phase: a.phase, label: a.label, url: a.url, taken_on: a.takenOn })
  },
  deleteAttachment: async (a) => { await post(`/attachments/${a.id}`, {}, 'DELETE') },
}

export const backend: Backend = BACKEND === 'local' ? localBackend : supabaseBackend
