import { useCallback, useRef, useState } from 'react'
import { ApiError, grade } from './api'
import type { Graded } from './board'
import { loadImage, type CaseMeta, type Loaded } from './cases/public'
import type { Tag } from './evidence'
import type { Submission } from './score'
import Home from './ui/Home'
import Results from './ui/Results'
import Workspace from './ui/Workspace'

type View =
  | { v: 'home' }
  | { v: 'case'; loaded: Loaded; n: number }
  | { v: 'results'; meta: CaseMeta; loaded: Loaded; result: Graded; submission: Submission; tags: Tag[]; elapsed: number }

const best = (id: string) => {
  try {
    return Number(localStorage.getItem(`carve:best:${id}`)) || null
  } catch {
    return null
  }
}
const saveBest = (id: string, total: number) => {
  try {
    localStorage.setItem(`carve:best:${id}`, String(Math.max(total, best(id) ?? 0)))
  } catch {
    /* private mode */
  }
}

export default function App() {
  const [view, setView] = useState<View>({ v: 'home' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Monotonic, not Date.now(): two starts inside one millisecond used to collide on the Workspace key, so it never
  // remounted and kept the previous case's context.
  const seq = useRef(0)
  // Bumped by every navigation and start, so a loadCase, grade or mentor answer that lands after the user moved on
  // is dropped instead of writing into an unmounted view.
  const live = useRef(0)

  const home = useCallback(() => {
    live.current++
    setBusy(null)
    setError(null)
    setView({ v: 'home' })
  }, [])

  const start = useCallback(
    async (id: string, fresh = false) => {
      const mine = ++live.current
      setBusy(id)
      setError(null)
      if (fresh)
        try {
          localStorage.removeItem(`carve:${id}`)
        } catch {
          /* private mode */
        }
      try {
        const loaded = await loadImage(id)
        if (mine !== live.current) return
        setView({ v: 'case', loaded, n: ++seq.current })
      } catch (e) {
        if (mine !== live.current) return
        setError(e instanceof Error ? e.message : 'Could not build the disk image.')
      } finally {
        if (mine === live.current) setBusy(null)
      }
    },
    [],
  )

  const submit = useCallback(async (loaded: Loaded, submission: Submission, tags: Tag[], elapsed: number) => {
    const mine = ++live.current
    setBusy(loaded.meta.id)
    setError(null)
    try {
      const res = await grade(loaded.meta.id, submission, elapsed)
      if (mine !== live.current) return
      saveBest(loaded.meta.id, res.result.total)
      setView({ v: 'results', meta: loaded.meta, loaded, result: res.result, submission, tags, elapsed })
    } catch (e) {
      if (mine !== live.current) return
      setError(
        e instanceof ApiError && e.status === 429
          ? 'Too many submissions in a row. Wait a minute, then press Submit findings again.'
          : `Could not grade this run: ${e instanceof Error ? e.message : 'unknown error'}`,
      )
    } finally {
      if (mine === live.current) setBusy(null)
    }
  }, [])

  if (view.v === 'case')
    return (
      <>
        <Workspace key={view.n} loaded={view.loaded} onExit={home} onSubmit={(s, tags, elapsed) => submit(view.loaded, s, tags, elapsed)} />
        {error && <Toast onDismiss={() => setError(null)}>{error}</Toast>}
      </>
    )
  if (view.v === 'results')
    return (
      <>
        <Results
          meta={view.meta}
          result={view.result}
          submission={view.submission}
          tags={view.tags}
          elapsed={view.elapsed}
          busy={busy === view.meta.id}
          onRetry={() => start(view.meta.id, true)}
          onHome={home}
        />
        {error && <Toast onDismiss={() => setError(null)}>{error}</Toast>}
      </>
    )
  return <Home onStart={(c: CaseMeta) => start(c.id)} busy={busy} error={error} onDismissError={() => setError(null)} />
}


export function Toast({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div role="alert" aria-live="assertive" className="fixed bottom-4 left-1/2 z-30 w-[min(92vw,520px)] -translate-x-1/2">
      <div className="flex items-start gap-3 rounded-md border border-bad/40 bg-panel px-4 py-3 shadow-lg">
        <p className="min-w-0 flex-1 text-sm text-ink">{children}</p>
        <button onClick={onDismiss} className="shrink-0 text-xs text-mute hover:text-ink">
          Dismiss
        </button>
      </div>
    </div>
  )
}
