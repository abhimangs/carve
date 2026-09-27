// bun test: the scoring rules against a synthetic key, so every number is hand-checkable.
import { describe, expect, test } from 'bun:test'
import { score, W, type Submission } from './score'
import { CASES, loadCase, type Key } from './cases'

const caseById = (id: string) => CASES.find((c) => c.id === id)!

const iso = (t: number) => new Date(t * 1000).toISOString().replace('.000Z', 'Z')

/** n items with the given truths, each with a distinct sha, plus m decoys. Every copy endorses $FN (B). */
function keyOf(truths: number[], m = 2): Key {
  return {
    evidence: truths.map((truth, i) => ({
      id: `e${i}`,
      sha: `e${i}`.padEnd(64, '0'),
      label: `item ${i}`,
      event: `event ${i}`,
      find: { path: `/files/e${i}` },
      t: iso(truth),
      timeSource: 'the $FN birth time (B) of the inode',
      why: 'it matters',
      truth,
    })),
    decoys: Array.from({ length: m }, (_, i) => ({ sha: `d${i}`.padEnd(64, '0'), label: `decoy ${i}`, why: 'not evidence' })),
  }
}

const key = (n: number, m = 2) => keyOf(Array.from({ length: n }, (_, i) => 1_700_000_000 + i * 3600), m)

const K = key(4)
const shas = K.evidence.map((e) => e.sha)

/** A perfect run on K: everything tagged, everything in true order, every time named from $SI Created (B). */
const perfect: Submission = {
  tagged: shas,
  timeline: K.evidence.map((e) => ({ sha: e.sha, t: e.truth, source: '$SI Created (B)' })),
  hints: 0,
}

describe('parts', () => {
  test('exactly four parts, maxed from W in order', () => {
    const p = score(K, perfect).parts
    expect(p).toHaveLength(4)
    expect(p.map((x) => x.max)).toEqual([W.recovery, W.order, W.time, W.precision])
    expect([W.recovery, W.order, W.time, W.precision]).toEqual([40, 25, 25, 10])
  })

  test('a perfect run is 100 and an empty submission is 0', () => {
    expect(score(K, perfect).total).toBe(100)
    expect(score(K, { tagged: [], timeline: [], hints: 0 }).total).toBe(0)
  })
})

describe('recovery', () => {
  test('40 * found / n', () => {
    for (let found = 0; found <= 4; found++) {
      const s = { ...perfect, tagged: shas.slice(0, found) }
      expect(score(K, s).parts[0].pts).toBeCloseTo((W.recovery * found) / 4)
    }
  })

  test('a tagged decoy is not a recovery', () => {
    const s = { ...perfect, tagged: [...shas, K.decoys[0].sha] }
    expect(score(K, s).parts[0].pts).toBe(40)
  })
})

describe('order', () => {
  test('one adjacent swap loses exactly one of the C(n,2) pairs', () => {
    for (let i = 0; i < 3; i++) {
      const tl = [...perfect.timeline]
      ;[tl[i], tl[i + 1]] = [tl[i + 1], tl[i]]
      expect(score(K, { ...perfect, timeline: tl }).parts[1].pts).toBeCloseTo((W.order * 5) / 6)
    }
  })

  test('untagged items are excluded from the numerator but stay in the denominator', () => {
    // Tag and place only the first two, in the right relative order: exactly one of the six pairs counts.
    const s: Submission = { tagged: shas.slice(0, 2), timeline: perfect.timeline.slice(0, 2), hints: 0 }
    const o = score(K, s).parts[1]
    expect(o.pts).toBeLessThan(W.order)
    expect(o.pts).toBeCloseTo((W.order * 1) / 6)
  })

  test('placing a correctly ordered item that was never tagged earns nothing', () => {
    const s: Submission = { tagged: shas.slice(0, 1), timeline: perfect.timeline, hints: 0 }
    expect(score(K, s).parts[1].pts).toBe(0)
  })

  test('items sharing a truth second drop out of the pair count entirely', () => {
    const k = keyOf([1_700_000_000, 1_700_000_000, 1_700_003_600])
    const kshas = k.evidence.map((e) => e.sha)
    const line = (order: number[]): Submission => ({
      tagged: kshas,
      timeline: order.map((i) => ({ sha: kshas[i], t: k.evidence[i].truth, source: '$SI Created (B)' })),
      hints: 0,
    })
    const twoPairs = (W.order * 2) / 2
    expect(score(k, line([0, 1, 2])).parts[1].pts).toBeCloseTo(twoPairs)
    // Swapping the two equal-truth items costs nothing: their pair was never in the denominator.
    expect(score(k, line([1, 0, 2])).parts[1].pts).toBeCloseTo(twoPairs)
    // Moving the later item to the front breaks both real pairs.
    expect(score(k, line([2, 0, 1])).parts[1].pts).toBe(0)
  })
})

describe('time', () => {
  const one = (patch: object) => {
    const s: Submission = { ...perfect, timeline: perfect.timeline.map((x, i) => (i === 0 ? { ...x, ...patch } : x)) }
    const r = score(K, s)
    return { ok: r.per[0].timeOk, pts: r.parts[2].pts }
  }

  test('right time and right source', () => {
    expect(one({ source: '$SI Created (B)' })).toEqual({ ok: true, pts: W.time })
  })

  test('right time, wrong source: no credit even at the right second', () => {
    const r = one({ source: '$SI Modified (M)' })
    expect(r.ok).toBe(false)
    expect(r.pts).toBeCloseTo((W.time * 3) / 4)
  })

  test('right time, no source: a hand-typed time names no field, so it cannot be the wrong one', () => {
    expect(one({ source: undefined })).toEqual({ ok: true, pts: W.time })
  })

  test('outside W.tolerance', () => {
    const near = one({ t: K.evidence[0].truth + W.tolerance })
    expect(near.ok).toBe(true)
    const far = one({ t: K.evidence[0].truth + W.tolerance + 1 })
    expect(far.ok).toBe(false)
    expect(far.pts).toBeCloseTo((W.time * 3) / 4)
  })

  test('an untagged item cannot score its time', () => {
    const s: Submission = { ...perfect, tagged: shas.slice(1) }
    expect(score(K, s).parts[2].pts).toBeCloseTo((W.time * 3) / 4)
  })
})

describe('precision', () => {
  test('10 * found / max(1, flagged), no clamp', () => {
    const s: Submission = { ...perfect, tagged: [K.decoys[0].sha] }
    const p = score(K, s).parts[3]
    expect(p.pts).toBe(0)
    expect(p.pts).toBeLessThan(W.precision) // a ratio with one of one tagged being a decoy, not clamped to 1
  })

  test('tagging decoys strictly lowers it', () => {
    const clean = score(K, perfect).parts[3].pts
    expect(clean).toBe(W.precision)
    const sprayed = score(K, { ...perfect, tagged: [...shas, ...K.decoys.map((d) => d.sha)] }).parts[3].pts
    expect(sprayed).toBeLessThan(clean)
    expect(sprayed).toBeCloseTo((W.precision * 4) / 6)
  })

  test('unknown shas on the board are not counted as flagged', () => {
    const s: Submission = { ...perfect, tagged: [...shas, 'f'.repeat(64)] }
    expect(score(K, s).parts[3].pts).toBe(W.precision)
  })
})

describe('penalties', () => {
  test('decoyPenalty is W.decoy per tagged decoy', () => {
    expect(score(K, perfect).decoyPenalty).toBe(0)
    expect(score(K, { ...perfect, tagged: [...shas, K.decoys[0].sha] }).decoyPenalty).toBe(W.decoy)
    expect(score(K, { ...perfect, tagged: [...shas, ...K.decoys.map((d) => d.sha)] }).decoyPenalty).toBe(W.decoy * 2)
  })

  test('hintPenalty is W.hint per hint plus W.question per question, absent questions counting as 0', () => {
    expect(score(K, { ...perfect, hints: 0 }).hintPenalty).toBe(0)
    expect(score(K, { ...perfect, hints: 2 }).hintPenalty).toBe(W.hint * 2)
    expect(score(K, { ...perfect, hints: 2, questions: 0 }).hintPenalty).toBe(W.hint * 2)
    expect(score(K, { ...perfect, hints: 2, questions: 3 }).hintPenalty).toBe(W.hint * 2 + W.question * 3)
  })

  test('total never goes below 0', () => {
    const drowned: Submission = { tagged: K.decoys.map((d) => d.sha), timeline: [], hints: 50, questions: 50 }
    const r = score(K, drowned)
    expect(r.total).toBe(0)
    expect(r.parts.every((p) => p.pts === 0)).toBe(true)
    expect(r.decoyPenalty + r.hintPenalty).toBeGreaterThan(100)
  })
})

describe('timeline hygiene', () => {
  test('a duplicate sha collapses to its first index, not its last', () => {
    const repeated: Submission = {
      ...perfect,
      timeline: [...perfect.timeline, { sha: shas[0], t: 1, source: '$SI Changed (C)' }],
    }
    const r = score(K, repeated)
    expect(r.per[0].chosen).toBe(K.evidence[0].truth)
    // If the repeat had won, item 0 would sit after the other three and every pair touching it would be wrong.
    expect(r.parts[1].pts).toBe(W.order)
    expect(r.parts[2].pts).toBe(W.time)
  })

  test('null times count as placed but not timed', () => {
    const s: Submission = { ...perfect, timeline: perfect.timeline.map((x) => ({ sha: x.sha, t: null })) }
    const r = score(K, s)
    expect(r.parts[1].pts).toBe(W.order)
    expect(r.parts[2].pts).toBe(0)
  })
})

describe('the timestamp field the case names', () => {
  test('a field the copy names discriminates, one it only dismisses does not', async () => {
    // insider/history's copy names the #epoch line, so naming the inode birth time is the wrong field and loses the
    // points even when the second happens to be close. insider/offer's copy names B, so M is rejected.
    const ins = await loadCase(caseById('insider'))
    const run = (key: (typeof ins)['key'], id: string, source: string) =>
      score(key, { tagged: key.evidence.map((x) => x.sha), timeline: key.evidence.map((x) => ({ sha: x.sha, t: x.truth, source })), hints: 0 }).per.find(
        (p) => p.id === id,
      )!
    expect(run(ins.key, 'offer', '$SI Created (B)').timeSourceOk).toBe(true)
    expect(run(ins.key, 'offer', '$SI Modified (M)').timeSourceOk).toBe(false)
    expect(run(ins.key, 'offer', '$SI Accessed (A)').timeSourceOk).toBe(false)
    expect(run(ins.key, 'history', '$SI Created (B)').timeSourceOk).toBe(false)
  })

  test('copy that names no known field makes the field check a no-op rather than rejecting everything', async () => {
    // ransomware/auth is answered from a line inside the log, not from any timestamp field, so its copy matches no
    // field pattern. Rejecting every field there would make the item impossible to earn.
    const { key } = await loadCase(caseById('ransomware'))
    const e = key.evidence.find((x) => x.id === 'auth')!
    expect(e.timeSource).toMatch(/Accepted password/)
    const p = score(key, { tagged: key.evidence.map((x) => x.sha), timeline: key.evidence.map((x) => ({ sha: x.sha, t: x.truth, source: '$SI Modified (M)' })), hints: 0 }).per.find(
      (x) => x.id === 'auth',
    )!
    expect(p.timeSourceOk).toBe(true)
    // It stays manual-only only because no dropdown candidate is within tolerance, which src/selfcheck.test.ts pins.
  })
})
