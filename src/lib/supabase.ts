import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined

/** 'local' uses the bundled Node server (server/index.mjs); anything else uses Supabase. */
export const BACKEND: 'local' | 'supabase' = import.meta.env.VITE_BACKEND === 'local' ? 'local' : 'supabase'

if (BACKEND === 'supabase' && (!url || !key)) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_KEY. Copy .env.example to .env, or set VITE_BACKEND=local.')
}

export const supabase = BACKEND === 'supabase' ? createClient(url!, key!) : (null as unknown as ReturnType<typeof createClient>)

export type Project = {
  id: string
  name: string
  platform: string
  store_url: string | null
  onboarded_on: string
  first_change_on: string | null
  created_at: string
}

export type Entry = {
  id: string
  project_id: string
  entry_date: string
  title: string
  note: string | null
  source: 'Manual' | 'Excel'
  created_at: string
}

export type MetricValue = {
  id: string
  project_id: string
  entry_id: string | null
  metric_key: string
  metric_label: string
  phase: 'before' | 'after'
  value: number
  recorded_on: string
  created_at: string
}
