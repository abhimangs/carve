# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git workflow (mandatory)

- After every change, commit and push right away (`git add -A && git commit -m "..." && git push`). Don't wait to be asked, and don't batch unrelated changes.
- Never add Claude as a co-author. No `Co-Authored-By: Claude` trailer, no session links and no "Generated with Claude Code" lines in commits or PRs.
- `.env` (API keys) and `.dev.vars` are gitignored. Keep it that way.

## Commands

```sh
bun install
bun run dev                     # Vite dev server (frontend only, /api/* not available)
bun run build                   # tsc -b + vite build -> dist/
bun run lint                    # oxlint
bun test                        # self-checks in src/selfcheck.test.ts
bun test -t "fraud"             # single test by name
npx tsc -p functions/tsconfig.json   # typecheck Pages Functions (workers types)
wrangler pages dev --port 8788       # full app + functions; needs OPENROUTER_API in .dev.vars
wrangler pages deploy --branch main --commit-dirty=true   # production: https://carve-a3h.pages.dev
```

`src/**/*.test.ts` is excluded from `tsconfig.app.json` because `bun:test` types aren't installed, so the build ignores tests.

## Architecture

Carve is a forensics trainer (hackathon brief CS-01 in `PROBLEM_STATEMENT.txt`). The key idea is that **every case is a real byte-level disk image**, not a JSON lookup.

**Data flow:** case script (`src/cases/*.ts`, a list of `Op`s) → `buildImage` (`src/fs/image.ts`) replays the ops into a 256 KiB `Uint8Array` → `Disk` (`src/fs/reader.ts`) parses it back → the terminal commands (`src/term/commands.ts`) and the UI read **only** through `Disk` and the carver. Case data is never read directly at runtime. This integrity rule is what makes deletion, overwrites and carving genuine.

**CarveFS** (layout constants and inode format are documented at the top of `reader.ts`):
- `delete` removes the dir entry, frees bitmap bits and keeps the inode and data.
- `wipe` zeroes the inode, so only `carveUnallocated` can find the data.
- `write` with `reuse: true` allocates first-fit onto freed blocks, which is how partial overwrites happen. The default is next-fit, which keeps files contiguous so carving works.
- `stomp` rewrites the $SI times but not the $FN shadow. `istat` flags it when `btime < fnBtime`.
- A write op's `as` alias names a specific inode when a path is later deleted and recreated (for example the old `.bash_history`).

**Answer keys:** `loadCase` (`src/cases/index.ts`) computes each evidence item's SHA-256 by running the same `Disk.read`, `carveUnallocated` or `carveEmbedded` the trainee uses, as chosen by its `Locator` (`{path}` | `{carve}` | `{embedded}`). Trainee tags are matched by hash. When editing a case, keep ops in chronological/allocation order and rerun `bun test`. The tests check that every key is recoverable, that decoys differ from evidence, that a perfect submission scores 100, and case-specific properties such as the overwrite, the timestomp and the embedded zip.

**File formats** (`src/fs/formats.ts`) are hand-built real formats: stored ZIP with CRC32 and DOS local times, JPEG with an EXIF APP1/TIFF IFD block (GPS time is UTC, DateTimeOriginal is local), DOCX (zip + `core.xml`), and PDF. Base JPEG pixels are base64 in `src/fs/fixtures.ts`. Timezone traps in the cases depend on these semantics.

**Scoring** (`src/score.ts`, pure; weights in `W`) is shared by the client and the leaderboard function. The timestamp candidates offered on evidence cards come from `src/evidence.ts`: inode MACB and $FN times, EXIF, docx and zip times, and `#epoch` lines in shell history.

**UI** (`src/ui`): `App` switches between the Home, Workspace and Results views. `Workspace` owns a mutable `Ctx` (cwd, `/recovered` overlay map, callbacks) that is shared with the xterm `Terminal`. GUI actions call `exec(cmd)`, which injects a real command into the terminal, so the GUI always teaches the CLI equivalent. Progress persists in `localStorage` under `carve:<caseId>`.

**Backend** (`functions/`, Cloudflare Pages Functions, `wrangler.jsonc`):
- `api/mentor.ts` calls OpenRouter with `MENTOR_MODEL` (`z-ai/glm-5.3-flash`, secret `OPENROUTER_API`). Reasoning can't be disabled on that model, so it sends `reasoning: { effort: 'minimal', exclude: true }` (about 0 reasoning tokens) and caps `max_tokens`. A daily USD budget (`MENTOR_DAILY_USD`, default 1) is tracked in KV (`spend:<date>`) from OpenRouter's reported `usage.cost`. Over budget, or if OpenRouter fails, it falls back to Workers AI (`AI` binding, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`). The client sends the live session (last commands with output, recovered files, evidence board) and the chat history; the prompt holds the answer key. A mentor question costs about $0.0002.
- `api/leaderboard.ts` stores the top 20 per case in the KV binding `LEADERBOARD` and re-scores submissions server-side with `loadCase` + `score`.
- Both functions import from `src/`, so `src/fs` must stay Workers-compatible (no `TextDecoder('latin1')`; use the `latin1` helper in `bytes.ts`).
- Local wrangler supports `compatibility_date` only up to 2026-06-02.

## UI conventions

The page is dark-only by design. Theme tokens live in `src/index.css` (`@theme`, amber is the single accent). Fonts are self-hosted Geist and JetBrains Mono (fontsource); icons come from `@phosphor-icons/react`. No em-dashes in user-visible copy.
