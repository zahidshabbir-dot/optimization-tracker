import { createClient } from '@supabase/supabase-js'

// Public values (safe in browser code). Env vars override them, e.g. for a staging project.
const DEFAULT_URL = 'https://xjlsybztnaraxbizzcui.supabase.co'
const DEFAULT_KEY = 'sb_publishable_b-yWrOktW1WqPMrVrA0pzA_QaPjcwjc'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_URL
const key = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) || DEFAULT_KEY

/** 'local' uses the bundled Node server (server/index.mjs); anything else uses Supabase. */
export const BACKEND: 'local' | 'supabase' = import.meta.env.VITE_BACKEND === 'local' ? 'local' : 'supabase'

export const supabase = createClient(url, key)
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

export type Attachment = {
  id: string
  project_id: string
  phase: 'before' | 'after'
  label: string | null
  url: string
  storage_path: string | null
  taken_on: string | null
  created_at: string
}
