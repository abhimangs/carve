import type { Key } from './cases'

export type Submission = {
  tagged: string[] // sha256 of every item the trainee tagged as evidence
  timeline: { sha: string; t: number | null }[] // trainee's order, with the time they chose (unix s)
  hints: number // static hints revealed
  questions?: number // AI mentor questions asked
}

export const W = { recovery: 40, order: 25, time: 25, precision: 10, hint: 5, question: 2, decoy: 3, tolerance: 60 }

export function score(key: Key, s: Submission) {
  const n = key.evidence.length
  const tagged = new Set(s.tagged)
  const pos = new Map(s.timeline.map((x, i) => [x.sha, i]))
  const chosen = new Map(s.timeline.map((x) => [x.sha, x.t]))

  const per = key.evidence.map((e) => {
    const t = chosen.get(e.sha) ?? null
    return {
      id: e.id,
      label: e.label,
      event: e.event,
      truth: e.truth,
      timeSource: e.timeSource,
      why: e.why,
      found: tagged.has(e.sha),
      placed: pos.has(e.sha),
      chosen: t,
      timeOk: t !== null && Math.abs(t - e.truth) <= W.tolerance,
    }
  })
  const found = per.filter((p) => p.found).length

  // Ordering: fraction of all evidence pairs placed in the true order (Kendall concordance).
  // Pairs involving an evidence item missing from the timeline count as wrong.
  let pairs = 0, good = 0
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = key.evidence[i], b = key.evidence[j]
      if (a.truth === b.truth) continue
      pairs++
      const pa = pos.get(a.sha), pb = pos.get(b.sha)
      if (pa !== undefined && pb !== undefined && pa < pb === a.truth < b.truth) good++
    }

  const decoys = key.decoys.filter((d) => tagged.has(d.sha))
  const recovery = (W.recovery * found) / n
  const order = pairs ? (W.order * good) / pairs : 0
  const time = (W.time * per.filter((p) => p.timeOk && p.found).length) / n
  const precision = Math.max(0, (W.precision * found) / n - W.decoy * decoys.length)
  const hintPenalty = W.hint * s.hints + W.question * (s.questions ?? 0)
  const total = Math.max(0, Math.round(recovery + order + time + precision - hintPenalty))

  return {
    total,
    parts: [
      { name: 'Recovery', pts: recovery, max: W.recovery, note: `${found}/${n} evidence items recovered` },
      { name: 'Timeline order', pts: order, max: W.order, note: `${good}/${pairs} event pairs in the correct order` },
      { name: 'Timestamp accuracy', pts: time, max: W.time, note: `${per.filter((p) => p.timeOk && p.found).length}/${n} true times within ±${W.tolerance}s` },
      { name: 'Precision', pts: precision, max: W.precision, note: decoys.length ? `${decoys.length} decoy(s) flagged` : 'no decoys flagged' },
    ],
    hintPenalty,
    per,
    decoys,
  }
}

export type Score = ReturnType<typeof score>
