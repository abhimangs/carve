export type Env = { NIM_API_KEY: string; MENTOR_MODEL: string; LEADERBOARD: KVNamespace; AI: Ai }

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } })

/** Coarse per-IP limit (KV is eventually consistent, so this is a speed bump, not a wall). */
export async function limited(env: Env, req: Request, bucket: string, max: number) {
  const ip = req.headers.get('cf-connecting-ip') ?? 'local'
  const key = `rl:${bucket}:${ip}:${Math.floor(Date.now() / 60000)}`
  const n = Number(await env.LEADERBOARD.get(key)) || 0
  if (n >= max) return true
  await env.LEADERBOARD.put(key, String(n + 1), { expirationTtl: 120 })
  return false
}
