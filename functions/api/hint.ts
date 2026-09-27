// One static hint per request. The hint text lives only here, never in the client bundle, and the count written below
// is what the leaderboard grades against, so the 5 point penalty cannot be dodged by reporting fewer hints.
import { CASES } from '../../src/cases'
import { clientIp, dayStamp, type Env, json, limited, limitedDaily, log, tooBig } from '../env'

const MAX_BODY = 4096 // a hint request is ~40 bytes
const PER_MIN = 10
const PER_DAY = 30 // the longest case carries five hints, so this is generous
const TTL = 3 * 86400 // the counter is only read back on the day it was written

const fail = (event: string, data: Record<string, unknown>, res: Response) => (log(event, data), res)

/** Hints revealed for one case and IP today, as the plain integer string the leaderboard reads with Math.min(50, ...). */
const count = async (env: Env, key: string) => {
  try {
    return Math.max(0, Number(await env.LEADERBOARD.get(key)) || 0)
  } catch (e) {
    log('hint_count_read_failed', { key, error: String(e) })
    return 0
  }
}

async function bump(env: Env, key: string) {
  try {
    // ponytail: read-modify-write on one KV key, so simultaneous reveals can undercount by one. Undercounting help
    // only makes the trainee look better and a hint is not worth a Durable Object.
    await env.LEADERBOARD.put(key, String((Number(await env.LEADERBOARD.get(key)) || 0) + 1), { expirationTtl: TTL })
  } catch (e) {
    log('hint_count_failed', { key, error: String(e) }) // fail open: a KV blip must not deny a trainee a hint
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const ip = clientIp(request)
  if (tooBig(request, MAX_BODY)) return fail('hint_too_big', { status: 413, ip, limit: MAX_BODY }, json({ error: 'request too large' }, 413))

  const b = (await request.json().catch(() => null)) as { caseId?: string; index?: number } | null
  const c = CASES.find((x) => x.id === b?.caseId)
  if (!c || !b) return fail('hint_bad_request', { ip, caseId: String(b?.caseId ?? '').slice(0, 40) }, json({ error: 'bad request' }, 400))
  // Never clamp: a clamped index would hand out the whole list behind one penalty, so index 9999 is a 400.
  const i = b.index
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= c.hints.length)
    return fail('hint_bad_index', { ip, caseId: c.id, index: i, len: c.hints.length }, json({ error: 'bad request' }, 400))

  if (await limited(env, request, 'hint', PER_MIN)) return fail('hint_rate_limited', { ip, caseId: c.id, scope: 'minute' }, json({ error: 'too many hints, try again later' }, 429))
  if (await limitedDaily(env, request, 'hint', PER_DAY)) return fail('hint_rate_limited', { ip, caseId: c.id, scope: 'day' }, json({ error: 'too many hints, try again later' }, 429))

  // Sequential only. Asking for an index you already paid for is free, which is what lets a restored session refetch
  // its hints without paying twice, but jumping ahead to index 3 first would dodge three of the five penalties.
  const key = `hints:${c.id}:${ip}:${dayStamp()}`
  const seen = await count(env, key)
  if (i > seen) return fail('hint_out_of_order', { ip, caseId: c.id, index: i, seen }, json({ error: 'bad request' }, 400))
  // Counted before the hint goes out and inside its own try, so a KV failure costs the counter, never the hint.
  if (i === seen) await bump(env, key)
  log('hint_revealed', { ip, caseId: c.id, index: i, repeat: i < seen })
  return json({ hint: c.hints[i], index: i })
}
