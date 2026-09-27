import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'

// Structural copies of the few shapes the shim touches, because the real modules cannot be named in a type position
// here: tsconfig.node.json resolves with node16/nodenext, which rejects their extensionless relative imports and
// would fail `tsc -b` on files this config does not own. Vite loads them instead (see carveDevApi), and a mismatch
// with the real module shows up at once in the dev server.
type Case = { id: string; hints: string[] }
type Key = { evidence: { sha: string }[]; decoys: { sha: string }[] }
type Submission = { tagged: string[]; timeline: { sha: string; t: number | null; source?: string }[]; hints: number; questions?: number }
type Mods = {
  CASES: Case[]
  loadCase: (c: Case) => Promise<{ key: Key }>
  score: (key: Key, s: Submission) => { total: number } & Record<string, unknown>
}
type Row = { name: string; score: number; timeMs: number; at: number } // same shape as src/board.ts
type PostResult = { result: Record<string, unknown>; recorded: boolean; rank: number | null; rows: Row[] }
type Read = { ok: true; body: unknown } | { ok: false; status: number; error: string }

const TOP = 20
const MAX_HINT = 4096 // same cap as functions/api/hint.ts
const MAX_BODY = 32 * 1024 // a real body is ~4 KB; same cap the mentor and leaderboard functions use
const MIN_MS = 5_000 // src/board.ts LB_MIN_MS
const MAX_MS = 6 * 60 * 60 * 1000 // src/board.ts LB_MAX_MS
const PER_MIN = 10 // src/board.ts LB_PER_MIN
const STUB = 'Mentor is stubbed in vite dev. Run `wrangler pages dev --port 8788` for the real AI.'
const STUB_DEBRIEF = 'Debrief is stubbed in vite dev, so there is nothing to grade. Run `wrangler pages dev --port 8788` for the real AI.'

/** One row per name, best score first, ties keep the faster run: the same rule as the real endpoint. */
const best = (rows: Row[]) => {
  const m = new Map<string, Row>()
  for (const r of rows) {
    const b = m.get(r.name)
    if (!b || r.score > b.score || (r.score === b.score && r.timeMs < b.timeMs)) m.set(r.name, r)
  }
  return [...m.values()].sort((x, y) => y.score - x.score || x.timeMs - y.timeMs || x.at - y.at).slice(0, TOP)
}

const hex64 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)

/** Serves the Pages Functions in dev so `bun run dev` is the whole app. Registered only through configureServer, so a
 * production build never sees it, and the case and scoring modules are loaded lazily inside the hook, so neither the
 * answer key nor this shim can reach a browser. Grading runs the real `score`, so dev and prod cannot drift. */
function carveDevApi(): Plugin {
  return {
    name: 'carve-dev-api',
    configureServer(server) {
      let mods: Promise<Mods> | null = null
      const api = () =>
        (mods ??= Promise.all([server.ssrLoadModule('/src/cases/index.ts'), server.ssrLoadModule('/src/score.ts')]).then(
          ([c, s]) => ({ CASES: c.CASES, loadCase: c.loadCase, score: s.score }) as Mods,
        ))
      // Only the image and its answer key are cached; a submission is never stored here.
      const keys = new Map<string, Promise<{ key: Key }>>()
      const boards = new Map<string, Row[]>()
      // Same per-minute cap as prod, kept in memory because there is no KV in dev.
      const hits = new Map<string, number>()
      const reveals = new Map<string, number>()
      const capped = (bucket: string) => {
        const k = `${bucket}:${Math.floor(Date.now() / 60000)}`
        const n = hits.get(k) ?? 0
        hits.set(k, n + 1)
        return n >= PER_MIN
      }

      const json = (res: ServerResponse, data: unknown, status = 200) => {
        res.statusCode = status
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify(data))
      }

      /** content-length is client supplied, so it is only the cheap first line; the byte count is the real cap. */
      const readJson = async (req: IncomingMessage, limit: number, big: string, bad: string): Promise<Read> => {
        if (Number(req.headers['content-length'] ?? 0) > limit) return { ok: false, status: 413, error: big }
        const chunks: Buffer[] = []
        let n = 0
        for await (const chunk of req) {
          const buf = chunk as Buffer
          n += buf.length
          if (n > limit) {
            req.destroy()
            return { ok: false, status: 413, error: big }
          }
          chunks.push(buf)
        }
        try {
          return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
        } catch {
          return { ok: false, status: 400, error: bad }
        }
      }

      const post = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
        const m = await api()

        if (url.pathname === '/api/leaderboard') {
          const raw = await readJson(req, MAX_BODY, 'submission too large', 'invalid submission')
          if (!raw.ok) return json(res, { error: raw.error }, raw.status)
          const b = raw.body as { caseId?: string; name?: string; submission?: Submission; timeMs?: number } | null
          const c = m.CASES.find((x) => x.id === b?.caseId)
          const s = b?.submission
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
          if (!valid || !c || !s) return json(res, { error: 'invalid submission' }, 400)
          if (capped('lb')) return json(res, { error: 'slow down' }, 429)

          let key: Key
          try {
            let p = keys.get(c.id)
            if (!p) keys.set(c.id, (p = m.loadCase(c)))
            key = (await p).key
          } catch (e) {
            return json(res, { error: `case image failed to build: ${e instanceof Error ? e.message : e}` }, 500)
          }

          const known = new Set([...key.evidence.map((e) => e.sha), ...key.decoys.map((d) => d.sha)])
          const seen = new Set<string>()
          const timeline: Submission['timeline'] = []
          for (const x of s.timeline) {
            if (!known.has(x.sha) || seen.has(x.sha)) continue // unknown sha earns nothing, a repeat keeps the first slot
            seen.add(x.sha)
            timeline.push({ sha: x.sha, t: x.t, source: typeof x.source === 'string' ? x.source.slice(0, 120) : undefined })
          }

          // Prod ignores these two numbers and grades against the hints: and usage: counters its own endpoints write to
          // KV, which is not worth faking here, so the client's counts stand in for them.
          const r = m.score(key, { tagged: s.tagged, timeline, hints: s.hints, questions: s.questions })
          const board = best(boards.get(c.id) ?? [])
          const out = (rows: Row[], recorded: boolean): PostResult => ({ result: r, recorded, rank: (rows.findIndex((x) => x.name === name) + 1) || null, rows })
          if (!name) return json(res, out(board, false))
          const mine = board.find((x) => x.name === name)
          if (mine && r.total <= mine.score) return json(res, out(board, false))

          const rows = best([...board.filter((x) => x.name !== name), { name, score: r.total, timeMs, at: Date.now() }])
          boards.set(c.id, rows)
          return json(res, out(rows, true))
        }

        if (url.pathname === '/api/hint') {
          const raw = await readJson(req, MAX_HINT, 'request too large', 'bad request')
          if (!raw.ok) return json(res, { error: raw.error }, raw.status)
          const b = raw.body as { caseId?: string; index?: number } | null
          const c = m.CASES.find((x) => x.id === b?.caseId)
          if (!c) return json(res, { error: 'bad request' }, 400)
          const i = b?.index
          if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= c.hints.length) return json(res, { error: 'bad request' }, 400)
          if (capped('hint')) return json(res, { error: 'too many hints, try again later' }, 429)
          // Sequential only, like the real endpoint: you may re-read what you already paid for, but you cannot jump
          // ahead to index 3 and dodge the counter.
          const seen = reveals.get(c.id) ?? 0
          if (i > seen) return json(res, { error: 'bad request' }, 400)
          if (i === seen) reveals.set(c.id, seen + 1)
          console.error(JSON.stringify({ event: 'hint_revealed', at: Date.now(), caseId: c.id, ip: 'local', index: i, dev: true }))
          return json(res, { hint: c.hints[i], index: i })
        }

        if (url.pathname === '/api/mentor') {
          const raw = await readJson(req, MAX_BODY, 'request too large', 'bad request')
          if (!raw.ok) return json(res, { error: raw.error }, raw.status)
          const b = raw.body as { caseId?: string; mode?: string } | null
          if (!m.CASES.some((x) => x.id === b?.caseId)) return json(res, { error: 'bad request' }, 400)
          return json(res, { answer: b?.mode === 'debrief' ? STUB_DEBRIEF : STUB, via: 'dev' })
        }

        return json(res, { error: 'not found' }, 404)
      }

      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()
        const route = `${req.method} ${url.pathname}`
        const go =
          req.method === 'GET' && url.pathname === '/api/leaderboard'
            ? api().then((m) => {
                const id = url.searchParams.get('case') ?? ''
                return m.CASES.some((c) => c.id === id) ? json(res, best(boards.get(id) ?? [])) : json(res, [])
              })
            : req.method === 'POST'
              ? post(req, res, url)
              : Promise.resolve().then(() => json(res, { error: 'not found' }, 404))
        // A restart can pull the module graph out from under an in-flight request, and a rejected load must not
        // become an unhandled rejection that takes the dev server down, so every path ends in JSON.
        go.catch((e) => {
          console.error(`[carve-dev-api] ${route} failed: ${e instanceof Error ? e.stack : e}`)
          if (!res.headersSent) json(res, { error: 'dev api failed' }, 500)
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), carveDevApi()],
})
