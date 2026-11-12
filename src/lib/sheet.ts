import readXlsxFile from 'read-excel-file/browser'
import writeXlsxFile from 'write-excel-file/browser'
import type { Project } from './supabase'
import { resolveMetric, STORED_LABEL } from './metrics'

export type ParsedRow = {
  line: number
  projectName: string
  projectId: string | null
  date: string | null
  metricRaw: string
  metricKey: string
  metricLabel: string
  phase: 'before' | 'after' | null
  value: number | null
  /** Source / notes text carried into the history entry */
  note: string
  problem: string | null
}

export type NewProjectPlan = { name: string; storeUrl: string; onboarded: string | null }

export type ParseResult = {
  rows: ParsedRow[]
  missingColumns: string[]
  sheet: string
  newProjects: NewProjectPlan[]
}

/** Row is fine except its project isn't in the dashboard yet (can be created on import). */
export const NEW_PROJECT = 'New project'

const COLS: Record<'project' | 'date' | 'metric' | 'phase' | 'value', RegExp> = {
  project: /^(project|client|store|brand|name)$/i,
  date: /^(date|day|recorded( on)?|month)$/i,
  metric: /^(metric|kpi|measure)$/i,
  phase: /^(before ?\/ ?after|phase|stage|period|type|before or after)$/i,
  value: /^(value|amount|number|result)$/i,
}

function parseCsv(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const delim = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); out.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row) }
  return out.filter((r) => r.some((c) => c.trim() !== ''))
}

const z = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`

function toDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : iso(v)
  if (typeof v === 'number') {
    // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return isNaN(d.getTime()) ? null : `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${z(+m[2])}-${z(+m[3])}`
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/) // day/month/year
  if (m) return `${m[3]}-${z(+m[2])}-${z(+m[1])}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : iso(d)
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null
  if (v == null) return null
  const s = String(v).replace(/[%$€£,\s]|s$/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return isFinite(n) ? n : null
}

function toPhase(v: unknown): 'before' | 'after' | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (/^(before|baseline|start|pre)$/.test(s)) return 'before'
  if (/^(after|result|current|post|now)$/.test(s)) return 'after'
  return null
}

type Grid = unknown[][]
const cellText = (c: unknown) => String(c ?? '').trim()

export async function parseFile(file: File, projects: Project[]): Promise<ParseResult> {
  const name = file.name.toLowerCase()
  let sheets: { sheet: string; data: Grid }[]
  if (name.endsWith('.csv')) sheets = [{ sheet: 'CSV', data: parseCsv(await file.text()) }]
  else if (name.endsWith('.xlsx')) sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: Grid }[]
  else if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. In Excel choose File › Save As › .xlsx, then upload again.')
  else throw new Error('Please choose an .xlsx or .csv file.')
  if (!sheets.some((s) => s.data.length)) throw new Error('The file is empty.')

  const byName = new Map(projects.map((p) => [p.name.trim().toLowerCase(), p.id]))
  const stores = findStoreLinks(sheets)

  // 1) Simple list layout on any sheet: Project | Date | Metric | Before/After | Value
  for (const s of sheets) {
    const res = parseLong(s.data, byName)
    if (res) return finish(res, s.sheet, stores)
  }
  // 2) Side-by-side layout: Project | Device/Metric | Before date | Before | After date | After | Current date | Current ...
  for (const s of sheets) {
    const res = parseWide(s.data, byName)
    if (res) return finish(res, s.sheet, stores)
  }
  throw new Error('Could not find data in this file. Use the template columns (Project, Date, Metric, Before/After, Value), or a sheet with Project plus Before / After / Current columns.')
}

function finish(rows: ParsedRow[], sheet: string, stores: Map<string, string>): ParseResult {
  // Projects not in the dashboard yet can be created during import.
  const fresh = new Map<string, NewProjectPlan>()
  for (const r of rows) {
    if (r.projectId || !r.projectName) continue
    const k = r.projectName.toLowerCase()
    const plan = fresh.get(k) ?? { name: r.projectName, storeUrl: stores.get(k) ?? '', onboarded: null }
    if (r.date && (!plan.onboarded || r.date < plan.onboarded)) plan.onboarded = r.date
    fresh.set(k, plan)
  }
  return { rows, missingColumns: [], sheet, newProjects: [...fresh.values()] }
}

function problemOf(r: ParsedRow, hasMetric: boolean): string | null {
  return !r.projectName ? 'No project'
    : !r.date ? 'No date in file'
    : !hasMetric ? 'No metric'
    : !r.phase ? 'Use Before or After'
    : r.value === null ? 'Value is not a number'
    : !r.projectId ? NEW_PROJECT
    : null
}

function parseLong(grid: Grid, byName: Map<string, string>): ParsedRow[] | null {
  const headerIdx = grid.findIndex((r) => r.filter((c) => typeof c === 'string' && Object.values(COLS).some((re) => re.test(c.trim()))).length >= 4)
  if (headerIdx < 0) return null
  const header = grid[headerIdx].map(cellText)
  const idx = Object.fromEntries((Object.keys(COLS) as (keyof typeof COLS)[]).map((k) => [k, header.findIndex((h) => COLS[k].test(h))])) as Record<keyof typeof COLS, number>
  if (Object.values(idx).some((i) => i < 0)) return null
  const rows: ParsedRow[] = []
  grid.slice(headerIdx + 1).forEach((r, i) => {
    if (!r.some((c) => cellText(c) !== '')) return
    const projectName = cellText(r[idx.project])
    const metricRaw = cellText(r[idx.metric])
    const { key, label } = resolveMetric(metricRaw || '?')
    const row: ParsedRow = {
      line: headerIdx + i + 2, projectName, projectId: byName.get(projectName.toLowerCase()) ?? null,
      date: toDate(r[idx.date]), metricRaw, metricKey: key, metricLabel: label,
      phase: toPhase(r[idx.phase]), value: toNumber(r[idx.value]), note: '', problem: null,
    }
    row.problem = problemOf(row, !!metricRaw)
    rows.push(row)
  })
  return rows
}

const PHASE_COLS: [RegExp, 'before' | 'after', string][] = [
  [/^(before|baseline)( \(.*\))?$/i, 'before', 'Before'],
  [/^(after)( \(.*\))?$/i, 'after', 'After'],
  [/^(current|today|latest|now)( \(.*\))?$/i, 'after', 'Current'],
]

function parseWide(grid: Grid, byName: Map<string, string>): ParsedRow[] | null {
  const headerIdx = grid.findIndex((r) => {
    const h = r.map(cellText)
    return h.some((c) => COLS.project.test(c)) && h.some((c) => PHASE_COLS[0][0].test(c)) && h.some((c) => PHASE_COLS[1][0].test(c) || PHASE_COLS[2][0].test(c))
  })
  if (headerIdx < 0) return null
  const header = grid[headerIdx].map(cellText)
  const col = (re: RegExp) => header.findIndex((h) => re.test(h))
  const projectCol = col(COLS.project)
  const metricCol = col(/^(device|metric|kpi|measure)$/i)
  const plain = col(/^date$/i)
  const groups = PHASE_COLS.map(([re, phase, word]) => ({
    phase, word,
    value: col(re),
    date: (() => { const d = col(new RegExp(`^${word} date$`, 'i')); return d >= 0 ? d : plain })(),
    notes: [col(new RegExp(`^${word} (source|notes?)$`, 'i'))].filter((i) => i >= 0),
  })).filter((g) => g.value >= 0)

  const rows: ParsedRow[] = []
  grid.slice(headerIdx + 1).forEach((r, i) => {
    const projectName = cellText(r[projectCol])
    if (!projectName) return
    const device = metricCol >= 0 ? cellText(r[metricCol]) : ''
    const m = deviceMetric(device)
    for (const g of groups) {
      const value = toNumber(r[g.value])
      if (value === null) continue // nothing to import for this side
      const note = g.notes.map((n) => cellText(r[n])).filter(Boolean).join(' · ')
      const row: ParsedRow = {
        line: headerIdx + i + 2, projectName, projectId: byName.get(projectName.toLowerCase()) ?? null,
        date: g.date >= 0 ? toDate(r[g.date]) : null, metricRaw: device, metricKey: m.key, metricLabel: m.label,
        phase: g.phase, value, note: `${g.word}${note ? ': ' + note : ''}`, problem: null,
      }
      row.problem = problemOf(row, true)
      rows.push(row)
    }
  })
  return rows.length ? rows : null
}

function deviceMetric(device: string) {
  const d = device.toLowerCase()
  if (/^mobile/.test(d)) return { key: 'mobile', label: STORED_LABEL.mobile }
  if (/^desktop/.test(d)) return { key: 'desktop', label: STORED_LABEL.desktop }
  if (!d || /not stated|unknown|n\/a/.test(d)) return { key: 'custom:speed-score', label: 'Speed score' }
  return resolveMetric(device)
}

/** Picks up store links from any sheet that has Project + Store/URL columns. */
function findStoreLinks(sheets: { data: Grid }[]) {
  const out = new Map<string, string>()
  for (const s of sheets) {
    const hi = s.data.findIndex((r) => r.map(cellText).some((c) => COLS.project.test(c)) && r.map(cellText).some((c) => /^(store|store link|url|website|domain)$/i.test(c)))
    if (hi < 0) continue
    const h = s.data[hi].map(cellText)
    const pc = h.findIndex((c) => COLS.project.test(c) && !/^store$/i.test(c))
    const sc = h.findIndex((c) => /^(store|store link|url|website|domain)$/i.test(c))
    if (pc < 0 || sc < 0) continue
    for (const r of s.data.slice(hi + 1)) {
      const p = cellText(r[pc]).toLowerCase(), u = cellText(r[sc])
      if (p && /\./.test(u) && !out.has(p)) out.set(p, /^https?:\/\//.test(u) ? u : 'https://' + u)
    }
  }
  return out
}

export async function downloadTemplate(projects: Project[]) {
  const names = projects.slice(0, 2).map((p) => p.name)
  const a = names[0] ?? 'Your client name'
  const b = names[1] ?? a
  const header = ['Project', 'Date', 'Metric', 'Before/After', 'Value'].map((v) => ({ value: v, fontWeight: 'bold' as const }))
  const d = new Date()
  const ex = (p: string, m: string, ph: string, v: number) => [{ value: p }, { value: d, type: Date, format: 'yyyy-mm-dd' }, { value: m }, { value: ph }, { value: v }]
  const data = [
    header,
    ex(a, STORED_LABEL.cvr, 'After', 2.6),
    ex(a, 'AOV', 'After', 84.0),
    ex(a, 'Mobile speed', 'After', 82),
    ex(b, 'CVR', 'Before', 1.9),
  ]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeXlsxFile(data as any, { columns: [{ width: 26 }, { width: 14 }, { width: 22 }, { width: 14 }, { width: 10 }] }).toFile('optimization-tracker-template.xlsx')
}


/** Export values in the same layout the importer reads, so the file can be edited and re-imported. */
export async function exportXlsx(projects: Project[], values: { project_id: string; recorded_on: string; metric_label: string; phase: string; value: number }[], fileName: string) {
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const rows = values
    .filter((v) => names.has(v.project_id))
    .sort((a, b) => names.get(a.project_id)!.localeCompare(names.get(b.project_id)!) || a.recorded_on.localeCompare(b.recorded_on) || a.metric_label.localeCompare(b.metric_label))
  const header = ['Project', 'Date', 'Metric', 'Before/After', 'Value'].map((v) => ({ value: v, fontWeight: 'bold' as const }))
  const data = [
    header,
    ...rows.map((v) => {
      const [y, m, d] = v.recorded_on.split('-').map(Number)
      return [
        { value: names.get(v.project_id)! },
        { value: new Date(y, m - 1, d), type: Date, format: 'yyyy-mm-dd' },
        { value: v.metric_label },
        { value: v.phase === 'before' ? 'Before' : 'After' },
        { value: Number(v.value), type: Number },
      ]
    }),
  ]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeXlsxFile(data as any, { columns: [{ width: 26 }, { width: 14 }, { width: 24 }, { width: 14 }, { width: 10 }] }).toFile(fileName)
}
