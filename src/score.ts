import type { Key } from './cases'

export type Submission = {
  tagged: string[] // sha256 of every item the trainee tagged as evidence
  timeline: { sha: string; t: number | null; source?: string }[] // trainee's order, the time they chose (unix s) and the field they read it from
  hints: number // static hints revealed
  questions?: number // AI mentor questions asked
}

export const W = { recovery: 40, order: 25, time: 25, precision: 10, hint: 5, question: 2, decoy: 3, tolerance: 60 }

// A ±60s window alone does not discriminate (a wrong inode field is often a second off), so the field the trainee
// read the time from has to be one the case names. Board labels are machine-built, case copy is prose, so both
// sides are reduced to timestamp fields: the label to the one it is, the copy to every field it mentions, since
// copy that offers "or docx core.xml created" endorses both. A hand-typed time names no field and cannot be wrong.
const LABELS: [RegExp, string][] = [
  [/^\$(?:SI|FN) Created/, 'b'],
  [/^\$SI Modified/, 'm'],
  [/^\$SI Accessed/, 'a'],
  [/^\$SI Changed/, 'c'],
  [/^EXIF GPS/, 'gps'],
  [/^EXIF/, 'exif'],
  [/^docx/, 'docx'],
  [/^zip entry/, 'zip'],
  [/^history:/, 'epoch'],
]
const COPY: [RegExp, string][] = [
  [/\$fn|birth time|\(b\)|\bcreated\b/i, 'b'],
  [/change time|\(c\)|unlinked/i, 'c'],
  [/gps/i, 'gps'],
  [/#\d{6,}|epoch/i, 'epoch'],
  [/exif|datetimeoriginal/i, 'exif'],
  [/docx|core\.xml/i, 'docx'],
  // 'last written' is deliberately absent: ransomware/auth's copy says the inode times only show when the log was last
  // written, which is a dismissal of the M field, not an endorsement of it.
  // 'last written' is deliberately absent: ransomware/auth's copy says the inode times only show when the log was
  // last written, which dismisses the M field rather than endorsing it.
  [/\(m\)|modified/i, 'm'],
  [/\(a\)|accessed/i, 'a'],
  [/\bzip\b|entry time|unzip/i, 'zip'],
]
const field = (label: string) => LABELS.find(([re]) => re.test(label))?.[1]
const fields = (copy: string) => new Set(COPY.filter(([re]) => re.test(copy)).map(([, f]) => f))

export function score(key: Key, s: Submission) {
  const n = key.evidence.length
  const tagged = new Set(s.tagged)
  const pos = new Map<string, number>()
  const picked = new Map<string, Submission['timeline'][number]>()
  s.timeline.forEach((x, i) => {
    if (pos.has(x.sha)) return // first placement wins; a repeat is a UI bug, not a second opinion
    pos.set(x.sha, i)
    picked.set(x.sha, x)
  })

  const per = key.evidence.map((e) => {
    const p = picked.get(e.sha)
    const t = p?.t ?? null
    const got = p?.source == null ? undefined : field(p.source)
    const want = fields(e.timeSource)
    const timeSourceOk = got == null || want.size === 0 || want.has(got)
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
      source: p?.source ?? null,
      timeSourceOk,
      timeOk: t !== null && Math.abs(t - e.truth) <= W.tolerance && timeSourceOk,
    }
  })
  const found = per.filter((p) => p.found).length

  // Ordering: fraction of all evidence pairs placed in the true order (Kendall concordance). A pair only counts
  // once both items are tagged and both sit in the timeline, so ordering cannot be graded on files you never
  // recovered. Every pair stays in the denominator, so tagging one item earns one pair, not a perfect 25.
  let pairs = 0, good = 0, placeable = 0
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = key.evidence[i], b = key.evidence[j]
      if (a.truth === b.truth) continue
      pairs++
      const pa = pos.get(a.sha), pb = pos.get(b.sha)
      if (pa === undefined || pb === undefined || !tagged.has(a.sha) || !tagged.has(b.sha)) continue
      placeable++
      if (pa < pb ? a.truth < b.truth : b.truth < a.truth) good++
    }

  const decoys = key.decoys.filter((d) => tagged.has(d.sha))
  const known = new Set([...key.evidence.map((e) => e.sha), ...key.decoys.map((d) => d.sha)])
  const flagged = [...tagged].filter((x) => known.has(x)).length
  const timed = per.filter((p) => p.timeOk && p.found).length
  const recovery = (W.recovery * found) / n
  const order = pairs ? (W.order * good) / pairs : 0
  const time = (W.time * timed) / n
  // Real ratio, no clamp: every decoy drags the denominator up, so spraying `tag` over `fls -r -d /` is net negative.
  const precision = (W.precision * found) / Math.max(1, flagged)
  // The ratio alone only costs a decoy ~4 points, which is not enough to make blind tagging pointless, so the flat
  // W.decoy hit stays as a total-level deduction. Brief and debrief copy still says "3 points per decoy".
  const decoyPenalty = W.decoy * decoys.length
  const hintPenalty = W.hint * s.hints + W.question * (s.questions ?? 0)
  const total = Math.max(0, Math.round(recovery + order + time + precision - decoyPenalty - hintPenalty))

  return {
    total,
    parts: [
      { name: 'Recovery', pts: recovery, max: W.recovery, note: `${found}/${n} evidence items recovered` },
      {
        name: 'Timeline order',
        pts: order,
        max: W.order,
        note: `${good}/${pairs} pairs correct (${found} of ${n} items recovered${placeable < pairs ? `, ${placeable} placeable` : ''})`,
      },
      { name: 'Timestamp accuracy', pts: time, max: W.time, note: `${timed}/${n} true times within ±${W.tolerance}s` },
      {
        name: 'Precision',
        pts: precision,
        max: W.precision,
        note: flagged ? `${found}/${flagged} tagged items are evidence${decoys.length ? `, ${decoys.length} decoy(s) flagged` : ''}` : 'nothing on the board scored',
      },
    ],
    hintPenalty,
    decoyPenalty,
    per,
    sources: per.map((p) => p.source ?? ''),
    decoys,
  }
}

export type Score = ReturnType<typeof score>
