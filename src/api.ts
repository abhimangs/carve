// Every network call the browser makes. Kept out of the components so `bun run dev`'s vite shim is the only other
// implementation and neither has to import a component to make a request.
import { LB_MAX_MS, LB_MIN_MS, type PostResult, type Row } from './board'
import type { Submission } from './score'

export type { PostResult, Row } from './board'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const post = async (path: string, body: unknown, ms: number) => {
  let r: Response
  try {
    r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.')
  }
  const data = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) throw new ApiError(r.status, data.error || `Server returned ${r.status}`)
  return data
}

export type MentorCtx = {
  cwd: string
  commands: { cmd: string; out: string }[]
  recovered: string[]
  tagged: string[]
  /** SHA-256 of everything on the evidence board, so the server can work out what is already found. */
  shas: string[]
}

/** `degraded` means the mentor answered from Workers AI because OpenRouter was over budget or failing. */
export const askMentor = (body: { caseId: string; mode: 'hint' | 'debrief'; question?: string; history?: { role: 'user' | 'assistant'; content: string }[]; context?: MentorCtx; summary?: string }) =>
  post('/api/mentor', body, 35000) as Promise<{ answer: string; via: string; degraded?: boolean }>

export const fetchHint = (caseId: string, index: number) => post('/api/hint', { caseId, index }, 10_000) as Promise<{ hint: string; index: number }>

export const getBoard = async (caseId: string) => {
  const r = await fetch(`/api/leaderboard?case=${encodeURIComponent(caseId)}`, { signal: AbortSignal.timeout(8000) })
  return r.ok ? ((await r.json()) as Row[]) : []
}

/** Grades server-side. Omit `name` to grade without touching the leaderboard, which is what Submit does. */
export const grade = (caseId: string, submission: Submission, timeMs: number, name?: string) =>
  post('/api/leaderboard', { caseId, submission, timeMs: Math.min(LB_MAX_MS, Math.max(LB_MIN_MS, Math.round(timeMs))), ...(name ? { name } : {}) }, 15000) as Promise<PostResult>
