import { useEffect, useState } from 'react'
import type { Loaded } from '../cases'
import { fmtTime } from '../fs/bytes'
import type { Score, Submission } from '../score'
import { Md, askMentor } from './Workspace'

type Row = { name: string; score: number; timeMs: number; at: number }

export default function Results({ loaded, result, submission, elapsed, onRetry, onHome }: { loaded: Loaded; result: Score; submission: Submission; elapsed: number; onRetry: () => void; onHome: () => void }) {
  const { c } = loaded
  const [debrief, setDebrief] = useState<string | null>(null)
  const [board, setBoard] = useState<Row[] | null>(null)
  const [name, setName] = useState('')
  const [posted, setPosted] = useState(false)

  useEffect(() => {
    const summary = [
      `Score ${result.total}/100.`,
      ...result.per.map((p) => `${p.id}: ${p.found ? 'recovered' : 'MISSED'}${p.found ? (p.timeOk ? ', time correct' : `, time wrong (chose ${p.chosen ? fmtTime(p.chosen) : 'none'}, truth ${fmtTime(p.truth)})`) : ''}`),
      `Decoys flagged: ${result.decoys.map((d) => d.label).join(', ') || 'none'}.`,
    ].join('\n')
    askMentor({ caseId: c.id, mode: 'debrief', summary })
      .then(setDebrief)
      .catch(() => setDebrief(''))
    fetch(`/api/leaderboard?case=${c.id}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setBoard)
      .catch(() => setBoard([]))
  }, [c.id, result])

  const post = async () => {
    const r = await fetch('/api/leaderboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: c.id, name, submission, timeMs: elapsed }) }).catch(() => null)
    if (r?.ok) {
      setBoard(await r.json())
      setPosted(true)
    }
  }

  const grade = result.total >= 90 ? 'Expert examiner' : result.total >= 70 ? 'Solid analyst' : result.total >= 40 ? 'Junior analyst' : 'Keep digging'
  const mins = `${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <button onClick={onHome} className="font-mono text-sm font-bold tracking-widest text-amber">
          CARVE
        </button>
        <div className="mt-8 grid gap-8 md:grid-cols-[240px_1fr]">
          <div>
            <div className="text-sm text-mute">Case report: {c.title}</div>
            <div className="mt-2 font-mono text-7xl font-bold tabular-nums">{result.total}</div>
            <div className="text-mute">/ 100 · {grade}</div>
            <div className="mt-2 font-mono text-xs text-faint">time {mins}</div>
            <div className="mt-6 flex gap-2">
              <button onClick={onRetry} className="rounded border border-line px-3 py-1.5 text-sm hover:border-amber">
                Retry case
              </button>
              <button onClick={onHome} className="rounded bg-amber px-3 py-1.5 text-sm font-semibold text-bg">
                All cases
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {result.parts.map((p) => (
              <div key={p.name}>
                <div className="flex justify-between text-sm">
                  <span>{p.name}</span>
                  <span className="font-mono text-mute">
                    {p.pts.toFixed(1)} / {p.max}
                  </span>
                </div>
                <div className="mt-1.5 h-0.5 bg-amber" style={{ width: `${(100 * p.pts) / p.max}%` }} />
                <div className="mt-0.5 text-xs text-faint">{p.note}</div>
              </div>
            ))}
            {result.hintPenalty > 0 && <div className="text-sm text-bad">Hint penalty −{result.hintPenalty}</div>}
          </div>
        </div>

        <h2 className="mt-12 text-lg font-semibold tracking-tight">True timeline</h2>
        <ol className="mt-3 divide-y divide-line rounded-lg border border-line bg-panel">
          {[...result.per]
            .sort((a, b) => a.truth - b.truth)
            .map((p) => (
              <li key={p.id} className="grid gap-x-4 gap-y-1 p-4 md:grid-cols-[170px_1fr]">
                <div className="font-mono text-xs text-mute">{fmtTime(p.truth)}</div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${p.found ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad'}`}>{p.found ? 'recovered' : 'missed'}</span>
                    {p.found && <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${p.timeOk ? 'bg-ok/15 text-ok' : 'bg-amber/15 text-amber'}`}>{p.timeOk ? 'time ✓' : `you said ${p.chosen ? fmtTime(p.chosen) : 'no time'}`}</span>}
                    <span className="text-sm font-medium">{p.event}</span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-faint">{p.label}</div>
                  <div className="mt-2 text-sm text-mute">
                    <span className="text-ink/80">Time source:</span> {p.timeSource}
                  </div>
                  <div className="mt-1 text-sm text-mute">
                    <span className="text-ink/80">Why it matters:</span> {p.why}
                  </div>
                </div>
              </li>
            ))}
        </ol>

        {result.decoys.length > 0 && (
          <>
            <h2 className="mt-8 text-lg font-semibold tracking-tight">Decoys you flagged (−3 each)</h2>
            <ul className="mt-3 space-y-2">
              {result.decoys.map((d) => (
                <li key={d.sha} className="rounded border border-bad/30 bg-bad/5 p-3 text-sm">
                  <span className="font-mono text-bad">{d.label}</span>: <span className="text-mute">{d.why}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <section className="rounded-lg border border-line bg-panel p-5">
            <h2 className="text-lg font-semibold tracking-tight">Mentor debrief</h2>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-mute">
              {debrief === null ? 'Writing your debrief…' : debrief ? <Md s={debrief} /> : 'Mentor offline. The timeline above explains each item.'}
            </div>
          </section>
          <section className="rounded-lg border border-line bg-panel p-5">
            <h2 className="text-lg font-semibold tracking-tight">Leaderboard</h2>
            {!posted && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (name.trim()) post()
                }}
                className="mt-3 flex gap-2"
              >
                <input value={name} onChange={(e) => setName(e.target.value.slice(0, 20))} placeholder="Your name" className="min-w-0 flex-1 rounded border border-line bg-bg px-2.5 py-1.5 text-sm" aria-label="Name for leaderboard" />
                <button className="rounded bg-raised px-3 text-sm text-amber">Post score</button>
              </form>
            )}
            <ol className="mt-3 space-y-1 font-mono text-sm">
              {board === null && <li className="text-faint">Loading…</li>}
              {board?.length === 0 && <li className="text-faint">No scores yet. Be the first.</li>}
              {board?.map((r, i) => (
                <li key={i} className="flex justify-between">
                  <span>
                    <span className="text-faint">{String(i + 1).padStart(2, ' ')}.</span> {r.name}
                  </span>
                  <span className="text-mute">
                    {r.score} <span className="text-faint">· {Math.round(r.timeMs / 60000)}m</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  )
}
