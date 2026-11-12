import { BACKEND, supabase, type Entry, type MetricValue, type Project } from './supabase'

export type Snapshot = { projects: Project[]; entries: Entry[]; values: MetricValue[] }
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
}

const friendly = (m: string) => (/projects_name_unique|duplicate key/.test(m) ? 'A project with that name already exists.' : m)

const supabaseBackend: Backend = {
  async load() {
    const [p, e, v] = await Promise.all([
      supabase.from('projects').select('*').order('onboarded_on', { ascending: false }),
      supabase.from('entries').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('metric_values').select('*'),
    ])
    const err = p.error || e.error || v.error
    if (err) throw new Error(err.message)
    return { projects: p.data as Project[], entries: e.data as Entry[], values: v.data as MetricValue[] }
  },
  subscribe(onChange, onStatus) {
    const ch = supabase.channel('tracker-changes')
    for (const table of ['projects', 'entries', 'metric_values']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
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
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
  async updateEntry(id, p) {
    const { error } = await supabase.rpc('update_entry', { p_entry: id, p_date: p.date, p_title: p.title, p_note: p.note, p_values: p.values })
    if (error) throw new Error(error.message)
  },
  async deleteEntry(id) {
    const { error } = await supabase.from('entries').delete().eq('id', id)
    if (error) throw new Error(error.message)
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
}

export const backend: Backend = BACKEND === 'local' ? localBackend : supabaseBackend
