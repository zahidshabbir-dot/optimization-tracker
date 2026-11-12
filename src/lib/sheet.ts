import { readSheet } from 'read-excel-file/browser'
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
  problem: string | null
}

export type ParseResult = {
  rows: ParsedRow[]
  missingColumns: string[]
}

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

export async function parseFile(file: File, projects: Project[]): Promise<ParseResult> {
  const name = file.name.toLowerCase()
  let grid: unknown[][]
  if (name.endsWith('.csv')) grid = parseCsv(await file.text())
  else if (name.endsWith('.xlsx')) grid = (await readSheet(file)) as unknown[][]
  else if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. In Excel choose File › Save As › .xlsx, then upload again.')
  else throw new Error('Please choose an .xlsx or .csv file.')

  if (!grid.length) throw new Error('The file is empty.')
  const headerIdx = grid.findIndex((r) => r.filter((c) => typeof c === 'string' && Object.values(COLS).some((re) => re.test(c.trim()))).length >= 3)
  if (headerIdx < 0) throw new Error('Could not find a header row. Use the columns: Project, Date, Metric, Before/After, Value.')
  const header = grid[headerIdx].map((c) => String(c ?? '').trim())
  const idx = Object.fromEntries(
    (Object.keys(COLS) as (keyof typeof COLS)[]).map((k) => [k, header.findIndex((h) => COLS[k].test(h))]),
  ) as Record<keyof typeof COLS, number>
  const missingColumns = (Object.keys(idx) as (keyof typeof COLS)[]).filter((k) => idx[k] < 0)
  if (missingColumns.length) return { rows: [], missingColumns }

  const byName = new Map(projects.map((p) => [p.name.trim().toLowerCase(), p.id]))
  const rows: ParsedRow[] = []
  grid.slice(headerIdx + 1).forEach((r, i) => {
    if (!r.some((c) => c != null && String(c).trim() !== '')) return
    const projectName = String(r[idx.project] ?? '').trim()
    const metricRaw = String(r[idx.metric] ?? '').trim()
    const { key, label } = resolveMetric(metricRaw || '?')
    const row: ParsedRow = {
      line: headerIdx + i + 2,
      projectName,
      projectId: byName.get(projectName.toLowerCase()) ?? null,
      date: toDate(r[idx.date]),
      metricRaw,
      metricKey: key,
      metricLabel: label,
      phase: toPhase(r[idx.phase]),
      value: toNumber(r[idx.value]),
      problem: null,
    }
    row.problem = !projectName ? 'No project'
      : !row.projectId ? 'Unknown project'
      : !row.date ? 'Bad date'
      : !metricRaw ? 'No metric'
      : !row.phase ? 'Use Before or After'
      : row.value === null ? 'Value is not a number'
      : null
    rows.push(row)
  })
  return { rows, missingColumns: [] }
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

