// KV leaderboard. Scores are recomputed server-side from the raw submission with the same scoring code.
import { CASES, loadCase } from '../../src/cases'
import { score, type Submission } from '../../src/score'
import { type Env, json, limited } from '../env'

type Row = { name: string; score: number; timeMs: number; at: number }
const TOP = 20

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const id = new URL(request.url).searchParams.get('case') ?? ''
  if (!CASES.some((c) => c.id === id)) return json([])
  return json((await env.LEADERBOARD.get<Row[]>(`lb:${id}`, 'json')) ?? [])
}

const hex64 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = (await request.json().catch(() => null)) as { caseId?: string; name?: string; submission?: Submission; timeMs?: number } | null
  const c = CASES.find((x) => x.id === b?.caseId)
  const s = b?.submission
  const name = String(b?.name ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 20)
  const valid =
    c && s && name &&
    Array.isArray(s.tagged) && s.tagged.length <= 60 && s.tagged.every(hex64) &&
    Array.isArray(s.timeline) && s.timeline.length <= 60 && s.timeline.every((x) => hex64(x?.sha) && (x.t === null || Number.isFinite(x.t))) &&
    Number.isInteger(s.hints) && s.hints >= 0 && s.hints <= 50 &&
    (s.questions === undefined || (Number.isInteger(s.questions) && s.questions >= 0 && s.questions <= 500)) &&
    Number.isFinite(b?.timeMs) && b!.timeMs! > 0
  if (!valid) return json({ error: 'invalid submission' }, 400)
  if (await limited(env, request, 'lb', 5)) return json({ error: 'slow down' }, 429)

  const { key } = await loadCase(c)
  const row: Row = { name, score: score(key, { tagged: s.tagged, timeline: s.timeline.map((x) => ({ sha: x.sha, t: x.t })), hints: s.hints, questions: s.questions }).total, timeMs: Math.round(b!.timeMs!), at: Date.now() }
  // ponytail: read-modify-write on one KV key; two posts in the same second can drop one. Use a Durable Object if it ever matters.
  const rows = [...((await env.LEADERBOARD.get<Row[]>(`lb:${c.id}`, 'json')) ?? []), row].sort((x, y) => y.score - x.score || x.timeMs - y.timeMs).slice(0, TOP)
  await env.LEADERBOARD.put(`lb:${c.id}`, JSON.stringify(rows))
  return json(rows)
}
