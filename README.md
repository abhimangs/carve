# Carve

A practice tool for recovering deleted files, analysing metadata and rebuilding forensic timelines. Built for CS-01: *Deleted-File & Metadata Recovery Trainer*.

**Live:** https://carve-a3h.pages.dev

## Why it's not a mock

Each case is a script of filesystem operations: create, write, delete, wipe inode, timestomp, and reuse freed blocks. The script is replayed byte by byte into a real 256 KiB disk image (CarveFS: superblock, block bitmap, inode table, directory blocks), built ahead of time and shipped to the browser as a binary asset. So:

- Deleting a file removes its directory entry but leaves the inode and data blocks, so `icat` really recovers it.
- Later writes land on freed blocks, which gives genuinely partial recoveries (`istat` flags `(realloc)` blocks).
- Wiped inodes can only be found by signature carving (JPEG `FFD8FF`/`FFD9`, `%PDF`/`%%EOF`, ZIP `PK0304`/EOCD).
- JPEG EXIF (TIFF IFDs, GPS), DOCX `core.xml`, ZIP and PDF files are generated as real formats.
- Timestomping rewrites `$SI` times and leaves the `$FN` shadow alone, the same way analysts catch it on NTFS.
- Answer keys are SHA-256 hashes computed server-side by the same reader and carver the trainee uses, so the key can't drift out of sync with the image. The key, the case ops and the hint text never reach the browser: it gets the image plus a small manifest, and every submission is re-graded on the server.

The image downloads as `.img`, so you can inspect it with `xxd` or any hex editor.

## Case images

Each case is committed as a prebuilt 256 KiB image in `public/cases/<id>.img`, fetched lazily when a trainee opens the case. Generate and verify them with:

```sh
bun run gen:images     # rebuild public/cases/*.img from src/cases/*.ts
bun run check:images   # fail if the committed images differ by even one byte
```

> **Editing a case in `src/cases/*.ts` requires re-running `bun run gen:images`.** The browser is served the committed image, not the script, so a forgotten regeneration ships a stale image: the case would not match its own brief, objective or answer key. `bun test` will not catch it, because the tests build the image from the ops. `bun run check:images` is the only guard, and it runs in CI.

## Cases

| Case | Difficulty | Skills |
|---|---|---|
| The Resignation | Easy | `fls -d`, `icat`, bash-history epochs |
| Locked Ledger | Medium | partial overwrite, carving, deletion (C) times, zip-internal times |
| Backdated | Hard | timestomp detection, EXIF GPS vs local time, a zip hidden after a JPEG's EOI marker |

## Scoring (100)

| Points | For |
|---|---|
| 40 | Recovery |
| 25 | Timeline order (pairwise concordance) |
| 25 | Timestamp accuracy (within ±60 s, read from a field the case names) |
| 10 | Precision (ratio, not a flat award) |

A timeline pair only counts once **both** items were recovered and placed, so ordering can't be graded on files you never recovered. A timestamp only scores if it is within `W.tolerance` (±60 s) *and* the field you read it from is one the case names, which is why `istat` and `exiftool` disagreeing by a second is still wrong if the brief only ever mentions `$FN` times. Precision is `10 * found / flagged`, so tagging more than you recovered drags the denominator up.

Deductions, on top: −`W.decoy` (3) per decoy flagged, −`W.hint` (5) per hint revealed, −`W.question` (2) per mentor question. The total floors at 0, so blind tagging is net negative. All of these numbers are `W` in `src/score.ts`, the one source for grading; hint and question counts are tallied in Workers KV, never taken from the client.

Grading happens in `POST /api/leaderboard`, which re-scores the raw submission server-side and returns the authoritative result. The answer key is not in the shipped bundle, and the client-side score is display-only.

## Stack

Vite, React 19, Tailwind v4, xterm.js and dnd-kit, deployed on Cloudflare Pages. Three Pages Functions sit behind it:

- `/api/leaderboard`: keeps the top 20 per case in Workers KV and grades submissions. The client posts its raw work, the server re-scores it and returns the authoritative result.
- `/api/hint`: serves the written hints, which live only here. One per request, strictly in order, and each reveal is counted in KV so the penalty can't be dodged by under-reporting.
- `/api/mentor`: the AI mentor, on OpenRouter (`https://openrouter.ai/api/v1/chat/completions`) with model `MENTOR_MODEL` (`z-ai/glm-5.3-flash`) and secret `OPENROUTER_API`. It knows the answer key and is told to coach without revealing it. A daily USD budget (`MENTOR_DAILY_USD`, default 1) is tracked in KV; once it is spent, or if OpenRouter fails, it falls back to Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast` on the `AI` binding).

## Develop

```sh
bun install
bun run dev                      # full app: a Vite plugin shims /api/* with the same score() the server uses
bun run gen:images               # rebuild public/cases/*.img after editing a case
bun run check:images             # verify the committed images match the case scripts
bun test                         # self-checks and unit tests
bun run check                    # lint + both typechecks + tests + build
bun run deploy                   # wrangler pages deploy --branch main --commit-dirty=true
wrangler pages dev --port 8788   # only needed for the real AI mentor; needs OPENROUTER_API in .dev.vars
```

`bun run dev` is a complete app: dev and production grade with the same `score()` and serve the same images, so they cannot drift. The one thing the shim cannot do is call OpenRouter, so use `wrangler pages dev` when you are working on the mentor.

Tests: `src/selfcheck.test.ts` and `src/cases/index.test.ts` (every answer key is recoverable, decoys differ, a perfect run scores 100, plus the overwrite, timestomp and embedded-zip properties), `src/score.test.ts`, `src/evidence.test.ts`, `src/term/commands.test.ts` and `src/fs/bytes.test.ts`. `bun run check` is the full local gate.

CI runs on GitHub Actions (`.github/workflows/ci.yml`): `bun install --frozen-lockfile`, then `bun run check:images` (a stale committed image fails the build) and `bun run check`, on every push and pull request.

Layout: `src/fs` (CarveFS builder, reader, carver, file formats) · `src/cases` (incident scripts and answer keys, server-only; the browser sees `src/cases/meta.ts` and the image) · `src/term` (command shell) · `src/ui` · `functions/api`.

All cases are fictional.
