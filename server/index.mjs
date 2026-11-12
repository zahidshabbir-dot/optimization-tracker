// Local backend: same data model as Supabase, SQLite storage, live updates over Server-Sent Events.
// Run: npm run server   (then set VITE_BACKEND=local in .env)
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'

const PORT = Number(process.env.PORT || 8787)
mkdirSync(new URL('./data/', import.meta.url), { recursive: true })
const db = new DatabaseSync(new URL('./data/tracker.db', import.meta.url).pathname)
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL DEFAULT 'Shopify',
  store_url TEXT, onboarded_on TEXT NOT NULL, first_change_on TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_date TEXT NOT NULL, title TEXT NOT NULL, note TEXT, source TEXT NOT NULL CHECK (source IN ('Manual','Excel')), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS metric_values (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE, metric_key TEXT NOT NULL, metric_label TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('before','after')), value REAL NOT NULL, recorded_on TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('before','after')), label TEXT, url TEXT NOT NULL, storage_path TEXT, taken_on TEXT, created_at TEXT NOT NULL);
`)

const now = () => new Date().toISOString()
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

function addEntry(p, date, title, note, source, values) {
  const id = randomUUID()
  db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?)').run(id, p, date, title, (note || '').trim() || null, source, now())
  const ins = db.prepare('INSERT INTO metric_values VALUES (?,?,?,?,?,?,?,?,?)')
  for (const v of values || []) {
    if (!['before', 'after'].includes(v.phase) || !Number.isFinite(Number(v.value)) || !v.metric_key) throw new Error('Invalid metric value')
    ins.run(randomUUID(), p, id, String(v.metric_key), String(v.metric_label || v.metric_key), v.phase, Number(v.value), date, now())
  }
  return id
}
function createProject({ name, platform, storeUrl, onboarded, values }) {
  if (!name?.trim()) throw new Error('Client name is required')
  if (!isDate(onboarded)) throw new Error('Invalid onboarding date')
  const id = randomUUID()
  db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?)').run(id, name.trim(), platform || 'Shopify', storeUrl?.trim() || null, onboarded, null, now())
  addEntry(id, onboarded, 'Onboarded', values?.length ? 'Starting numbers recorded' : 'Project created', 'Manual', values)
  return id
}
function tx(fn) {
  db.exec('BEGIN')
  try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
}

const clients = new Set()
const broadcast = () => { for (const c of clients) c.write(`data: change\n\n`) }
setInterval(() => { for (const c of clients) c.write(`: ping\n\n`) }, 25000)

const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const readBody = (req) => new Promise((ok, bad) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 2e6) bad(new Error('Too large')) }); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}) } catch (e) { bad(e) } }) })

createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/data') {
      return send(res, 200, {
        projects: db.prepare('SELECT * FROM projects ORDER BY onboarded_on DESC').all(),
        entries: db.prepare('SELECT * FROM entries ORDER BY entry_date DESC, created_at DESC').all(),
        values: db.prepare('SELECT * FROM metric_values').all(),
        attachments: db.prepare('SELECT * FROM attachments ORDER BY taken_on, created_at').all(),
      })
    }
    if (req.method === 'GET' && req.url === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write('data: hello\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    if (req.method === 'POST' && req.url === '/api/entries') {
      const b = await readBody(req)
      if (!db.prepare('SELECT 1 FROM projects WHERE id=?').get(b.projectId)) return send(res, 400, { error: 'Unknown project' })
      if (!isDate(b.date)) return send(res, 400, { error: 'Invalid date' })
      const id = tx(() => addEntry(b.projectId, b.date, String(b.title || 'Data added'), b.note, b.source === 'Excel' ? 'Excel' : 'Manual', b.values))
      broadcast(); return send(res, 201, { id })
    }
    if (req.method === 'POST' && req.url === '/api/projects') {
      const b = await readBody(req)
      const id = tx(() => createProject(b))
      broadcast(); return send(res, 201, { id })
    }
    if (req.method === 'POST' && req.url === '/api/attachments') {
      const b = await readBody(req)
      if (!/^https?:\/\//i.test(b.url || '')) return send(res, 400, { error: 'Links must start with http:// or https://' })
      if (!['before', 'after'].includes(b.phase)) return send(res, 400, { error: 'Choose Before or After' })
      if (!db.prepare('SELECT 1 FROM projects WHERE id=?').get(b.project_id)) return send(res, 400, { error: 'Unknown project' })
      const id = randomUUID()
      db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?)').run(id, b.project_id, b.phase, (b.label || '').trim() || null, b.url.trim(), null, isDate(b.taken_on) ? b.taken_on : null, now())
      broadcast(); return send(res, 201, { id })
    }
    const m = req.url.match(/^\/api\/(projects|entries|attachments)\/([0-9a-f-]{36})$/)
    if (m && req.method === 'DELETE') {
      db.prepare(`DELETE FROM ${m[1]} WHERE id=?`).run(m[2])
      broadcast(); return send(res, 200, { id: m[2] })
    }
    if (m && req.method === 'PUT' && m[1] === 'projects') {
      const b = await readBody(req)
      if (!b.name?.trim() || !isDate(b.onboarded_on)) return send(res, 400, { error: 'Name and onboarding date are required' })
      if (db.prepare('SELECT 1 FROM projects WHERE lower(name)=lower(?) AND id<>?').get(b.name.trim(), m[2])) return send(res, 400, { error: 'A project with that name already exists.' })
      db.prepare('UPDATE projects SET name=?, platform=?, store_url=?, onboarded_on=?, first_change_on=? WHERE id=?')
        .run(b.name.trim(), b.platform || 'Shopify', b.store_url || null, b.onboarded_on, isDate(b.first_change_on) ? b.first_change_on : null, m[2])
      broadcast(); return send(res, 200, { id: m[2] })
    }
    if (m && req.method === 'PUT' && m[1] === 'entries') {
      const b = await readBody(req)
      if (!isDate(b.date)) return send(res, 400, { error: 'Invalid date' })
      const e = db.prepare('SELECT project_id FROM entries WHERE id=?').get(m[2])
      if (!e) return send(res, 404, { error: 'Entry not found' })
      tx(() => {
        db.prepare('UPDATE entries SET entry_date=?, title=?, note=? WHERE id=?').run(b.date, String(b.title || 'Data added'), (b.note || '').trim() || null, m[2])
        db.prepare('DELETE FROM metric_values WHERE entry_id=?').run(m[2])
        const ins = db.prepare('INSERT INTO metric_values VALUES (?,?,?,?,?,?,?,?,?)')
        for (const v of b.values || []) {
          if (!['before', 'after'].includes(v.phase) || !Number.isFinite(Number(v.value))) throw new Error('Invalid metric value')
          ins.run(randomUUID(), e.project_id, m[2], String(v.metric_key), String(v.metric_label || v.metric_key), v.phase, Number(v.value), b.date, now())
        }
      })
      broadcast(); return send(res, 200, { id: m[2] })
    }
    send(res, 404, { error: 'Not found' })
  } catch (e) {
    send(res, 400, { error: e.message })
  }
}).listen(PORT, () => console.log(`Local tracker API on http://localhost:${PORT}`))
