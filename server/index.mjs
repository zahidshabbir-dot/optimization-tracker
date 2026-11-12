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

// Seed with the same sample clients as the Supabase project.
if (db.prepare('SELECT count(*) n FROM projects').get().n === 0) {
  tx(() => {
    const V = (k, l, ph, v) => ({ metric_key: k, metric_label: l, phase: ph, value: v })
    const seed = [['Linen & Loom', 'Shopify', '2026-10-14', 1.2, null, 29, null], ['Peak Fitness Gear', 'Shopify Plus', '2026-09-23', 1.9, null, 34, null],
      ['Haven Home Decor', 'Shopify', '2026-08-11', 2.2, 3.1, 41, 88], ['Bloom & Co Florals', 'Shopify', '2026-06-02', 1.4, 1.5, 52, 58],
      ['Northwind Outdoors', 'Shopify Plus', '2026-04-18', 2.1, 2.9, 45, 76]]
    for (const [n, pl, on, cb, ca, sb, sa] of seed) {
      const id = createProject({ name: n, platform: pl, onboarded: on, values: [V('cvr', 'Conversion rate', 'before', cb), V('mobile', 'Mobile speed', 'before', sb)] })
      if (ca != null) addEntry(id, '2026-10-31', 'October numbers added', 'Conversion rate and mobile score', 'Excel', [V('cvr', 'Conversion rate', 'after', ca), V('mobile', 'Mobile speed', 'after', sa)])
    }
    const a = createProject({ name: 'Aurora Skincare', platform: 'Shopify', onboarded: '2026-03-04', values: [V('cvr', 'Conversion rate', 'before', 1.8), V('mobile', 'Mobile speed', 'before', 38), V('desktop', 'Desktop speed', 'before', 61), V('lcp', 'Load time (LCP)', 'before', 5.8), V('aov', 'Average order value', 'before', 72.4), V('rpv', 'Revenue per visitor', 'before', 1.3)] })
    db.prepare('UPDATE projects SET first_change_on=? WHERE id=?').run('2026-04-15', a)
    addEntry(a, '2026-04-15', 'First change live', 'Image and script clean-up', 'Manual', [V('mobile', 'Mobile speed', 'after', 55)])
    addEntry(a, '2026-06-09', 'Product page layout test', 'Sticky add to cart on mobile', 'Manual', [V('cvr', 'Conversion rate', 'after', 2.4)])
    addEntry(a, '2026-08-20', 'Checkout step reduced', 'Fewer fields on mobile', 'Manual', [V('cvr', 'Conversion rate', 'after', 2.5)])
    addEntry(a, '2026-11-03', 'October numbers added', 'Conversion rate and mobile score', 'Excel', [V('cvr', 'Conversion rate', 'after', 2.6), V('mobile', 'Mobile speed', 'after', 82), V('desktop', 'Desktop speed', 'after', 94), V('lcp', 'Load time (LCP)', 'after', 2.3), V('aov', 'Average order value', 'after', 84.1), V('rpv', 'Revenue per visitor', 'after', 2.19)])
  })
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
    send(res, 404, { error: 'Not found' })
  } catch (e) {
    send(res, 400, { error: e.message })
  }
}).listen(PORT, () => console.log(`Local tracker API on http://localhost:${PORT}`))
