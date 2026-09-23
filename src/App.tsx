import { useState } from 'react'
import { type Case, type Loaded, loadCase } from './cases'
import type { Tag } from './evidence'
import { type Score, type Submission, score } from './score'
import Home from './ui/Home'
import Results from './ui/Results'
import Workspace from './ui/Workspace'

type View =
  | { v: 'home' }
  | { v: 'case'; loaded: Loaded; n: number }
  | { v: 'results'; loaded: Loaded; result: Score; submission: Submission; tags: Tag[]; elapsed: number }

export default function App() {
  const [view, setView] = useState<View>({ v: 'home' })
  const [busy, setBusy] = useState<string | null>(null)

  const start = async (c: Case, fresh = false) => {
    setBusy(c.id)
    if (fresh) {
      try {
        localStorage.removeItem(`carve:${c.id}`)
      } catch {
        /* ignore */
      }
    }
    const loaded = await loadCase(c)
    setBusy(null)
    setView({ v: 'case', loaded, n: Date.now() })
  }

  if (view.v === 'case')
    return (
      <Workspace
        key={view.n}
        loaded={view.loaded}
        onExit={() => setView({ v: 'home' })}
        onSubmit={(submission, tags, elapsed) => {
          const result = score(view.loaded.key, submission)
          try {
            const k = `carve:best:${view.loaded.c.id}`
            localStorage.setItem(k, String(Math.max(result.total, Number(localStorage.getItem(k)) || 0)))
          } catch {
            /* ignore */
          }
          setView({ v: 'results', loaded: view.loaded, result, submission, tags, elapsed })
        }}
      />
    )
  if (view.v === 'results')
    return <Results loaded={view.loaded} result={view.result} submission={view.submission} elapsed={view.elapsed} onRetry={() => start(view.loaded.c, true)} onHome={() => setView({ v: 'home' })} />
  return <Home onStart={(c) => start(c)} busy={busy} />
}
