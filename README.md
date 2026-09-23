# Carve

A practice tool for recovering deleted files, analysing metadata and rebuilding forensic timelines. Built for CS-01: *Deleted-File & Metadata Recovery Trainer*.

**Live:** https://carve-a3h.pages.dev

## Why it's not a mock

Each case is a script of filesystem operations: create, write, delete, wipe inode, timestomp, and reuse freed blocks. The script is replayed byte by byte into a real 256 KiB disk image (CarveFS: superblock, block bitmap, inode table, directory blocks) in the browser. So:

- Deleting a file removes its directory entry but leaves the inode and data blocks, so `icat` really recovers it.
- Later writes land on freed blocks, which gives genuinely partial recoveries (`istat` flags `(realloc)` blocks).
- Wiped inodes can only be found by signature carving (JPEG `FFD8FF`/`FFD9`, `%PDF`/`%%EOF`, ZIP `PK0304`/EOCD).
- JPEG EXIF (TIFF IFDs, GPS), DOCX `core.xml`, ZIP and PDF files are generated as real formats.
- Timestomping rewrites `$SI` times and leaves the `$FN` shadow alone, the same way analysts catch it on NTFS.
- Answer keys are SHA-256 hashes computed by the same reader and carver the trainee uses, so the key can't drift out of sync with the image.

The image downloads as `.img`, so you can inspect it with `xxd` or any hex editor.

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
| 25 | Timestamp accuracy (within ±60 s) |
| 10 | Precision |

Deductions: −3 per decoy tagged and −5 per hint. The leaderboard re-scores every submission on the server.

## Stack

Vite, React 19, Tailwind v4, xterm.js and dnd-kit, deployed on Cloudflare Pages. Two Pages Functions sit behind it:

- `/api/mentor`: the NVIDIA NIM mentor. It knows the answer key and is told to coach without revealing it.
- `/api/leaderboard`: stored in Workers KV.

## Develop

```sh
bun install
bun test                 # image/answer-key self-checks for every case
bun run build
wrangler pages dev       # needs NIM_API_KEY in .dev.vars
wrangler pages deploy
```

Layout: `src/fs` (CarveFS builder, reader, carver, file formats) · `src/cases` (incident scripts and answer keys) · `src/term` (command shell) · `src/ui` · `functions/api`.

All cases are fictional.
