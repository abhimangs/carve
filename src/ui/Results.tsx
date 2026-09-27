import { useEffect, useRef, useState } from 'react'
import { ApiError, askMentor, getBoard, grade, type Row } from '../api'
import type { Graded } from '../board'
import type { CaseMeta } from '../cases/public'
import { fmtTime } from '../fs/bytes'
import type { Tag } from '../evidence'
import type { Submission } from '../score'
import { Md } from './bits'

const fmtDur = (ms: number) => `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`

export default function Results({
  meta,
  result,
  submission,
  tags,
  elapsed,
  busy,
  onRetry,
  onHome,
}: {
  meta: CaseMeta
  result: Graded
  submission: Submission
  tags: Tag[]
  elapsed: number
  busy: boolean
  onRetry: () => void
  onHome: () => void
}) {
  const [debrief, setDebrief] = useState<string | null>(null)
  const [degraded, setDegraded] = useState(false)
  const [board, setBoard] = useState<Row[] | null>(null)
  const [name, setName] = useState('')
  const [posting, setPosting] = useState(false)
  const [postNote, setPostNote] = useState<{ rank: number | null; recorded: boolean } | null>(null)
  const [postErr, setPostErr] = useState<string | null>(null)
  const head = useRef<HTMLHeadingElement>(null)

  useEffect(() => head.current?.focus(), [])

  // StrictMode double-invokes effects in dev, and a debrief is a paid request, so guard it.
  const debriefed = useRef(false)
  useEffect(() => {
    if (debriefed.current) return
    debriefed.current = true
    const ac = new AbortController()
    const summary = [
      `Score ${result.total}/100.`,
      ...result.per.map(
        (p) =>
          `${p.id}: ${p.found ? 'recovered' : 'MISSED'}${
            p.found
              ? p.timeOk
                ? ', time correct'
                : p.timeSourceOk
                  ? `, wrong field (chose ${p.source ?? 'a manual time'}, truth ${fmtTime(p.truth)})`
                  : `, time wrong (chose ${p.chosen !== null ? fmtTime(p.chosen) : 'none'}, truth ${fmtTime(p.truth)})`
              : ''
          }`,
      ),
      `Decoys flagged: ${result.decoys.map((d) => d.label).join(', ') || 'none'}.`,
      `Files still untagged in the session: ${tags.length}.`,
    ].join('\n')
    askMentor({ caseId: meta.id, mode: 'debrief', summary })
      .then((r) => {
        setDebrief(r.answer)
        setDegraded(!!r.degraded)
      })
      .catch(() => {
        if (!ac.signal.aborted) setDebrief('')
      })
    return () => ac.abort()
  }, [meta.id, result, tags.length])

  useEffect(() => {
    const ac = new AbortController()
    getBoard(meta.id)
      .then((rows) => {
        if (!ac.signal.aborted) setBoard(rows)
      })
      .catch(() => {
        if (!ac.signal.aborted) setBoard([])
      })
    return () => ac.abort()
  }, [meta.id])

  const post = async () => {
    if (posting) return
    setPosting(true)
    setPostErr(null)
    try {
      const r = await grade(meta.id, submission, elapsed, name.trim())
      setBoard(r.rows)
      setPostNote({ rank: r.rank, recorded: r.recorded })
      if (r.result.total !== result.total) setPostErr(`The server scored this run ${r.result.total}, not ${result.total}. The leaderboard uses the server's number.`)
    } catch (e) {
      setPostErr(e instanceof ApiError ? e.message : 'Could not post the score.')
    } finally {
      setPosting(false)
    }
  }

  const grade_ = result.total >= 90 ? 'Expert examiner' : result.total >= 70 ? 'Solid analyst' : result.total >= 40 ? 'Junior analyst' : 'Keep digging'
  const missed = result.per.filter((p) => !p.found).length

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <nav aria-label="Primary">
          <button onClick={onHome} className="font-mono text-sm font-bold tracking-widest text-amber">
            CARVE
          </button>
        </nav>
        <h1 ref={head} tabIndex={-1} className="sr-only">
          Case report: {meta.title}
        </h1>
        <main>
        <div className="mt-8 grid gap-8 md:grid-cols-[240px_1fr]">
          <div>
            <div className="text-sm text-mute">Case report: {meta.title}</div>
            <div className="mt-2 font-mono text-7xl font-bold tabular-nums">{result.total}</div>
            <div className="text-mute">/ 100 · {grade_}</div>
            <div className="mt-2 font-mono text-xs text-faint">time {fmtDur(elapsed)}</div>
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => {
                  if (confirm('Retry case? Your tags, timeline and hints for this run are cleared. This cannot be undone.')) onRetry()
                }}
                disabled={busy}
                className="rounded border border-line px-3 py-1.5 text-sm hover:border-amber disabled:opacity-60"
              >
                {busy ? 'Restarting' : 'Retry case'}
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
            {result.decoyPenalty > 0 && (
              <div className="flex justify-between text-sm text-bad">
                <span>Decoys flagged</span>
                <span className="font-mono">−{result.decoyPenalty.toFixed(1)}</span>
              </div>
            )}
            {result.hintPenalty > 0 && (
              <div className="flex justify-between text-sm text-bad">
                <span>Help used ({result.hintPenalty} points)</span>
                <span className="font-mono">−{result.hintPenalty.toFixed(1)}</span>
              </div>
            )}
            {missed > 0 && <p className="pt-1 text-xs text-faint">{missed} of {result.per.length} evidence items were never recovered.</p>}
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
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${p.found ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad'}`}>
                      {p.found ? 'recovered' : 'missed'}
                    </span>
                    {p.found && (
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${p.timeOk ? 'bg-ok/15 text-ok' : 'bg-amber/15 text-amber'}`}
                        title={!p.timeSourceOk ? 'Right time, but you read it from the wrong field' : undefined}
                      >
                        {p.timeOk ? 'time ✓' : !p.timeSourceOk ? 'wrong field' : `you said ${p.chosen !== null ? fmtTime(p.chosen) : 'no time'}`}
                      </span>
                    )}
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
            <h2 className="mt-8 text-lg font-semibold tracking-tight">Decoys you flagged</h2>
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
          <section aria-labelledby="debrief-h" className="rounded-lg border border-line bg-panel p-5">
            <h2 id="debrief-h" className="text-lg font-semibold tracking-tight">
              Mentor debrief
            </h2>
            <div aria-live="polite" aria-busy={debrief === null} className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-mute">
              {debrief === null ? (
                'Writing your debrief…'
              ) : debrief ? (
                <>
                  <Md s={debrief} />
                  {degraded && <p className="mt-3 text-xs text-faint">The mentor is on its free fallback model, so this review is more basic than usual.</p>}
                </>
              ) : (
                'Mentor offline. The timeline above explains each item.'
              )}
            </div>
          </section>
          <section aria-labelledby="board-h" className="rounded-lg border border-line bg-panel p-5">
            <h2 id="board-h" className="text-lg font-semibold tracking-tight">
              Leaderboard
            </h2>
            {!postNote && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (name.trim()) post()
                }}
                className="mt-3 flex gap-2"
              >
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 20))}
                  placeholder="Your name"
                  className="min-w-0 flex-1 rounded border border-line bg-bg px-2.5 py-1.5 text-sm"
                  aria-label="Name for the leaderboard"
                  maxLength={20}
                />
                <button type="submit" disabled={posting || !name.trim()} className="rounded bg-raised px-3 text-sm text-amber disabled:opacity-60">
                  {posting ? 'Posting…' : 'Post score'}
                </button>
              </form>
            )}
            <div aria-live="polite" className="mt-2 text-xs">
              {postNote?.recorded && postNote.rank && <span className="text-ok">Posted. You are #{postNote.rank} on this case.</span>}
              {postNote && !postNote.recorded && <span className="text-mute">Your best run for this name is already on the board, so this one was not added.</span>}
              {postErr && <span className="text-bad">{postErr}</span>}
            </div>
            <ol aria-busy={board === null} className="mt-3 space-y-1 font-mono text-sm">
              {board === null && <li className="text-faint">Loading…</li>}
              {board?.length === 0 && <li className="text-faint">No scores yet. Be the first.</li>}
              {board?.map((r, i) => (
                <li key={`${r.name}-${i}`} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="text-faint">{String(i + 1).padStart(2, ' ')}.</span> {r.name}
                  </span>
                  <span className="shrink-0 text-mute">
                    {r.score} <span className="text-faint">· {Math.round(r.timeMs / 60000)}m</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
        </main>
      </div>
    </div>
  )
}
