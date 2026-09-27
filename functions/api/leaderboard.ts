// KV leaderboard. Scores are recomputed server-side from the raw submission with the same scoring code, and the
// graded result is returned whether or not a name was supplied, so the browser never has to hold the answer key.
import { CASES, loadCase, type Case, type Loaded } from '../../src/cases'
import { score, type Submission } from '../../src/score'
import { LB_MAX_MS, LB_MIN_MS, LB_PER_MIN, type PostResult, type Row } from '../../src/board'
import { clientIp, dayStamp, type Env, json, limited, log, tooBig } from '../env'

export type { PostResult, Row } from '../../src/board'

const TOP = 20
const MAX_BODY = 32 * 1024 // a real submission is ~4 KB; this only stops someone pasting a novel
const MIN_MS = LB_MIN_MS
const MAX_MS = LB_MAX_MS

// Only the image and its answer key are cached; a submission is never stored here.
const cases = new Map<string, Promise<Loaded>>()
function keyOf(c: Case) {
  let p = cases.get(c.id)
  if (!p) cases.set(c.id, (p = loadCase(c)))
  return p
}

/** One row per name, best score first: a name can only ever hold its best run, and ties keep the earliest. */
const best = (rows: Row[]) => {
  const m = new Map<string, Row>()
  for (const r of rows) {
    const b = m.get(r.name)
    if (!b || r.score > b.score || (r.score === b.score && r.timeMs < b.timeMs)) m.set(r.name, r)
  }
  return [...m.values()].sort((x, y) => y.score - x.score || x.timeMs - y.timeMs || x.at - y.at).slice(0, TOP)
}
const fail = (event: string, data: Record<string, unknown>, res: Response) => (log(event, data), res)

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const id = new URL(request.url).searchParams.get('case') ?? ''
  if (!CASES.some((c) => c.id === id)) return json([])
  return json(best((await env.LEADERBOARD.get<Row[]>(`lb:${id}`, 'json')) ?? []))
}

const hex64 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const ip = clientIp(request)
  if (tooBig(request, MAX_BODY)) return fail('lb_too_big', { status: 413, ip, limit: MAX_BODY }, json({ error: 'submission too large' }, 413))

  const b = (await request.json().catch(() => null)) as { caseId?: string; name?: string; submission?: Submission; timeMs?: number } | null
  const c = CASES.find((x) => x.id === b?.caseId)
  const s = b?.submission
  // No name means "just grade it": the Results screen reads the score before the trainee has entered one.
  const name = String(b?.name ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 20)
  const timeMs = Number(b?.timeMs)
  const valid =
    c && s &&
    Array.isArray(s.tagged) && s.tagged.length <= 60 && s.tagged.every(hex64) &&
    Array.isArray(s.timeline) && s.timeline.length <= 60 && s.timeline.every((x) =>
      hex64(x?.sha) && (x.t === null || Number.isFinite(x.t)) && (x.source === undefined || (typeof x.source === 'string' && x.source.length <= 120))) &&
    Number.isInteger(s.hints) && s.hints >= 0 && s.hints <= 50 &&
    (s.questions === undefined || (Number.isInteger(s.questions) && s.questions >= 0 && s.questions <= 500)) &&
    Number.isInteger(timeMs) && timeMs >= MIN_MS && timeMs <= MAX_MS
  if (!valid) return fail('lb_invalid', { status: 400, ip, caseId: String(b?.caseId ?? '').slice(0, 40), timeMs }, json({ error: 'invalid submission' }, 400))
  if (await limited(env, request, 'lb', LB_PER_MIN)) return fail('lb_rate_limited', { status: 429, ip, caseId: c.id }, json({ error: 'slow down' }, 429))

  let key: Loaded['key']
  try {
    key = (await keyOf(c)).key
  } catch (e) {
    return fail('lb_case_unavailable', { status: 500, ip, caseId: c.id, error: String(e) }, json({ error: `case image failed to build: ${e instanceof Error ? e.message : e}` }, 500))
  }

  // The client's hints/questions are never trusted. The mentor path bumps usage:<caseId>:<ip>:<date> per accepted
  // call and the hint path bumps hints:<caseId>:<ip>:<date>; a counter that was never written means no help was
  // used, and a counter we cannot read must not invent a penalty, so both fail to 0.
  const day = dayStamp()
  const [hints, questions] = await Promise.all([
    env.LEADERBOARD.get(`hints:${c.id}:${ip}:${day}`),
    env.LEADERBOARD.get(`usage:${c.id}:${ip}:${day}`),
  ])

  const known = new Set([...key.evidence.map((e) => e.sha), ...key.decoys.map((d) => d.sha)])
  const seen = new Set<string>()
  const timeline: Submission['timeline'] = []
  for (const x of s.timeline) {
    if (!known.has(x.sha) || seen.has(x.sha)) continue // unknown sha earns nothing, a repeat keeps the first slot
    seen.add(x.sha)
    timeline.push({ sha: x.sha, t: x.t, source: typeof x.source === 'string' ? x.source.slice(0, 120) : undefined })
  }

  const r = score(key, {
    tagged: s.tagged,
    timeline,
    hints: Math.min(50, Number(hints) || 0),
    questions: Math.min(500, Number(questions) || 0),
  })
  const board = best((await env.LEADERBOARD.get<Row[]>(`lb:${c.id}`, 'json')) ?? [])
  const res = (rows: Row[], recorded: boolean): PostResult => ({ result: r, recorded, rank: (rows.findIndex((x) => x.name === name) + 1) || null, rows })
  if (!name) return json(res(board, false))

  // Best-only per name: one row per name, and a later run can never trade a stored score for a faster time.
  const mine = board.find((x) => x.name === name)
  if (mine && r.total <= mine.score) {
    log('lb_not_recorded', { ip, caseId: c.id, name, score: r.total, best: mine.score })
    return json(res(board, false))
  }

  const row: Row = { name, score: r.total, timeMs, at: Date.now() }
  const rows = best([...board.filter((x) => x.name !== name), row])
  // ponytail: read-modify-write on one KV key, so two concurrent posts can drop a row. Use a Durable Object if it ever matters.
  try {
    await env.LEADERBOARD.put(`lb:${c.id}`, JSON.stringify(rows))
  } catch (e) {
    return fail('lb_write_failed', { status: 500, ip, caseId: c.id, name, error: String(e) }, json({ error: 'could not save score' }, 500))
  }
  const out = res(rows, true)
  log('lb_recorded', { ip, caseId: c.id, name, score: r.total, timeMs, rank: out.rank })
  return json(out)
}
