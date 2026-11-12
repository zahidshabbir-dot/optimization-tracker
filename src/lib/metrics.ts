import type { Entry, MetricValue, Project } from './supabase'

export type MetricDef = {
  key: string
  short: string
  label: string
  unit: string
  ph: string
  lowerIsBetter?: boolean
  format: (v: number) => string
}

const pct = (v: number) => `${Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? v.toFixed(1) : v.toFixed(2)}%`
const money = (v: number) => `$${v.toFixed(2)}`
const score = (v: number) => String(Math.round(v))
const secs = (v: number) => `${v.toFixed(1)} s`
const plain = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

export const METRICS: MetricDef[] = [
  { key: 'cvr', short: 'CVR', label: 'Conversion rate (CVR)', unit: '%', ph: '2.6', format: pct },
  { key: 'aov', short: 'AOV', label: 'Average order value (AOV)', unit: 'currency', ph: '84.00', format: money },
  { key: 'rpv', short: 'RPV', label: 'Revenue per visitor (RPV)', unit: 'currency', ph: '2.19', format: money },
  { key: 'mobile', short: 'Mobile speed', label: 'Mobile speed score', unit: '0–100', ph: '82', format: score },
  { key: 'desktop', short: 'Desktop speed', label: 'Desktop speed score', unit: '0–100', ph: '94', format: score },
  { key: 'lcp', short: 'Load time (LCP)', label: 'Load time (LCP)', unit: 'seconds', ph: '2.3', lowerIsBetter: true, format: secs },
]

export const STORED_LABEL: Record<string, string> = {
  cvr: 'Conversion rate',
  aov: 'Average order value',
  rpv: 'Revenue per visitor',
  mobile: 'Mobile speed',
  desktop: 'Desktop speed',
  lcp: 'Load time (LCP)',
}

export function metricDef(key: string, label?: string): MetricDef {
  const found = METRICS.find((m) => m.key === key)
  if (found) return found
  const name = label || key.replace(/^custom:/, '')
  return { key, short: name, label: name, unit: '', ph: '', format: plain }
}

export function slugKey(name: string) {
  return 'custom:' + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Map a free-text metric name (from Excel or typed) to a known key, else a custom key. */
export function resolveMetric(name: string): { key: string; label: string } {
  const n = name.trim().toLowerCase()
  const rules: [RegExp, string][] = [
    [/^(cvr|conv(ersion)?( rate)?|cr)$/, 'cvr'],
    [/^(aov|average order value|avg order value)$/, 'aov'],
    [/^(rpv|revenue per visitor)$/, 'rpv'],
    [/^(mobile( speed)?( score)?|speed|page speed|mobile pagespeed)$/, 'mobile'],
    [/^(desktop( speed)?( score)?)$/, 'desktop'],
    [/^(lcp|load time( \(lcp\))?|largest contentful paint)$/, 'lcp'],
  ]
  for (const [re, key] of rules) if (re.test(n)) return { key, label: STORED_LABEL[key] }
  return { key: slugKey(name), label: name.trim() }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

export function today() {
  const d = new Date()
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

const byTime = (a: MetricValue, b: MetricValue) =>
  a.recorded_on.localeCompare(b.recorded_on) || a.created_at.localeCompare(b.created_at)

export type MetricSummary = {
  key: string
  label: string
  def: MetricDef
  before: number | null
  after: number | null
  /** % change, sign-adjusted so positive = better */
  lift: number | null
}

export function summarize(values: MetricValue[]): Map<string, MetricSummary> {
  const out = new Map<string, MetricSummary>()
  const sorted = [...values].sort(byTime)
  for (const v of sorted) {
    let s = out.get(v.metric_key)
    if (!s) {
      s = { key: v.metric_key, label: v.metric_label, def: metricDef(v.metric_key, v.metric_label), before: null, after: null, lift: null }
      out.set(v.metric_key, s)
    }
    if (v.phase === 'before' && s.before === null) s.before = Number(v.value) // earliest baseline
    if (v.phase === 'after') s.after = Number(v.value) // latest result
  }
  for (const s of out.values()) {
    if (s.before !== null && s.after !== null && s.before !== 0) {
      const raw = ((s.after - s.before) / Math.abs(s.before)) * 100
      s.lift = s.def.lowerIsBetter ? -raw : raw
    }
  }
  return out
}

export type Status = 'Improving' | 'Needs attention' | 'Onboarding'
export const STATUS_DOT: Record<Status, string> = {
  Improving: '#6E9A14',
  'Needs attention': '#E0922B',
  Onboarding: '#9AA7C7',
}

export function statusOf(sums: Map<string, MetricSummary>): Status {
  const cvr = sums.get('cvr')
  if (!cvr || cvr.lift === null) return 'Onboarding'
  return cvr.lift >= 15 ? 'Improving' : 'Needs attention'
}

export function signed(n: number, digits = 0) {
  const r = Number(n.toFixed(digits))
  return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(digits)
}

export function projectView(p: Project, values: MetricValue[], entries: Entry[]) {
  const sums = summarize(values)
  const status = statusOf(sums)
  const firstAfter = values.filter((v) => v.phase === 'after').map((v) => v.recorded_on).sort()[0] ?? null
  const lastEntry = entries.map((e) => e.entry_date).sort().at(-1) ?? null
  return {
    project: p,
    sums,
    status,
    firstChange: p.first_change_on ?? firstAfter,
    lastData: lastEntry,
  }
}
