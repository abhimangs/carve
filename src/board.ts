// The leaderboard wire contract, shared by the browser, the Pages Function and the vite dev shim so the three
// cannot drift. Imported with `import type` from client code, so it carries no runtime cost and pulls in no
// case data.
import type { Score } from './score'

export type Row = { name: string; score: number; timeMs: number; at: number }

/** Everything the debrief needs. `Score.sources` is omitted because it just repeats `per[].source`. */
export type Graded = Pick<Score, 'total' | 'parts' | 'per' | 'decoys' | 'hintPenalty' | 'decoyPenalty'>

/** `recorded` is false when the run was graded but not put on the board, which is also the no-name case. */
export type PostResult = { result: Graded; recorded: boolean; rank: number | null; rows: Row[] }

export const LB_PER_MIN = 10
export const LB_MIN_MS = 5_000
export const LB_MAX_MS = 6 * 60 * 60 * 1000
