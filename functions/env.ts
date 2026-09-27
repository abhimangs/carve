export type Env = { OPENROUTER_API: string; MENTOR_MODEL: string; MENTOR_DAILY_USD?: string; LEADERBOARD: KVNamespace; AI: Ai }

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } })

/** One structured stderr line per event. Never pass prompts, answers or keys in `data`. */
export const log = (event: string, data: Record<string, unknown>) => console.error(JSON.stringify({ event, at: Date.now(), ...data }))

export const clientIp = (req: Request) => req.headers.get('cf-connecting-ip') ?? 'local'

/** Pre-parse body cap. content-length is client supplied, so this is a cheap first line, not a guarantee. */
export const tooBig = (req: Request, limit: number) => Number(req.headers.get('content-length') ?? 0) > limit

export const dayStamp = () => new Date().toISOString().slice(0, 10)

// ponytail: this is not a hard wall. The in-memory count serialises a burst that lands on one isolate and KV
// carries the count across isolates, but a KV read can be 60s stale and each extra isolate keeps its own
// counter, so N isolates admit up to N x max per window. The thing that actually caps spend is the USD
// budget in mentor.ts, plus the credit limit on the OpenRouter key.
const mem = new Map<string, number>()

async function over(env: Env, key: string, max: number, ttl: number) {
  const seen = (mem.get(key) ?? 0) + 1
  if (mem.size > 4096) mem.clear()
  mem.set(key, seen)
  if (seen > max) return true // blocked before touching KV, so a rejected call costs no write
  try {
    const n = Number(await env.LEADERBOARD.get(key)) || 0
    if (n >= max) return true
    await env.LEADERBOARD.put(key, String(n + 1), { expirationTtl: ttl })
  } catch (e) {
    log('rl_kv_error', { key, error: String(e) }) // fail open: a KV outage must not 500 the endpoint, the in-memory count still bounds this isolate
  }
  return false
}

/** Per-IP cap for one window. `true` means blocked. Fails open on KV errors. */
export const limited = (env: Env, req: Request, bucket: string, max: number) =>
  over(env, `rl:${bucket}:${clientIp(req)}:${Math.floor(Date.now() / 60000)}`, max, 120)

/** Per-IP cap for the whole UTC day, counted independently of the per-minute bucket. `true` means blocked. */
export const limitedDaily = (env: Env, req: Request, bucket: string, max: number) =>
  over(env, `rl:${bucket}:d:${dayStamp()}:${clientIp(req)}`, max, 2 * 86400)
