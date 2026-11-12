import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Entry, MetricValue, Project } from './supabase'
import { backend, type EntryInput, type LiveStatus, type ProjectInput } from './backend'

export type { NewValue } from './backend'

type TrackerData = {
  projects: Project[]
  entries: Entry[]
  values: MetricValue[]
  loading: boolean
  error: string | null
  live: LiveStatus
  refresh: () => Promise<void>
}

const Ctx = createContext<TrackerData | null>(null)

export function TrackerProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [values, setValues] = useState<MetricValue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState<LiveStatus>('connecting')
  const timer = useRef<number | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      const s = await backend.load()
      setProjects(s.projects)
      setEntries(s.entries)
      setValues(s.values.map((x) => ({ ...x, value: Number(x.value) })))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    // Any write from any browser triggers a (debounced) reload, so every screen stays live.
    const unsub = backend.subscribe(
      () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(refresh, 150) },
      setLive,
    )
    return () => { window.clearTimeout(timer.current); unsub() }
  }, [refresh])

  const value = useMemo(
    () => ({ projects, entries, values, loading, error, live, refresh }),
    [projects, entries, values, loading, error, live, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTracker() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTracker must be used inside TrackerProvider')
  return v
}

/** Writes one history entry plus its metric values in a single transaction. */
export const addEntry = (a: EntryInput) => backend.addEntry(a)
/** Creates a project plus its "Onboarded" entry and starting numbers, atomically. */
export const createProject = (a: ProjectInput) => backend.createProject(a)
