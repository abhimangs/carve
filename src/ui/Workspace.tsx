import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowUp, CaretDown, CaretRight, CircleHalf, DotsSixVertical, DownloadSimple, Lightbulb, Timer as TimerIcon, X } from '@phosphor-icons/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, askMentor, fetchHint, type MentorCtx } from '../api'
import { LB_MAX_MS } from '../board'
import type { Loaded } from '../cases/public'
import { type Candidate, type Tag, candidates, describe } from '../evidence'
import { fmtTime, td } from '../fs/bytes'
import { readDocx, readExif, sniff } from '../fs/formats'
import { ROOT } from '../fs/reader'
import { W, type Submission } from '../score'
import { C, type Ctx, RECOVERED, type Target } from '../term/commands'
import { Difficulty, Md } from './bits'
import Crash from './Crash'
import Terminal from './Terminal'

type Chat = { q: string; a: string }[]
type Saved = { tags: Tag[]; shown: number; started: number; chat: Chat }
const STALE_MS = LB_MAX_MS // a restored session older than the server's own time cap would be rejected
const load = (id: string): Saved | null => {
  try {
    const v = JSON.parse(localStorage.getItem(`carve:${id}`) ?? 'null') as Saved | null
    if (!v || typeof v.started !== 'number') return null
    // Closing the tab for a day used to post an 86400m run, which the server rejects and the board cannot rank.
    return Date.now() - v.started > STALE_MS ? null : v
  } catch {
    return null
  }
}
const save = (id: string, s: Saved) => {
  try {
    localStorage.setItem(`carve:${id}`, JSON.stringify(s))
  } catch {
    /* private mode: progress just isn't persisted */
  }
}

export default function Workspace({ loaded, onExit, onSubmit }: { loaded: Loaded; onExit: () => void; onSubmit: (s: Submission, tags: Tag[], elapsed: number) => void }) {
  const { meta, disk } = loaded
  const c = meta
  const init = useMemo(() => load(c.id), [c.id])
  const [tags, setTags] = useState<Tag[]>(init?.tags ?? [])
  const [shown, setShown] = useState(init?.shown ?? 0)
  const [hints, setHints] = useState<string[]>([])
  const [hintErr, setHintErr] = useState<string | null>(null)
  const [noHints, setNoHints] = useState(false)
  const [chat, setChat] = useState<Chat>((init?.chat ?? []).slice(-20))
  // Recent terminal activity, so the mentor can see what the trainee actually did.
  const log = useRef<{ cmd: string; out: string }[]>([])
  const tagsRef = useRef(tags)
  useEffect(() => {
    tagsRef.current = tags
  }, [tags])
  const [started] = useState(() => init?.started ?? Date.now())
  const [reveal, setReveal] = useState(false)
  const [selected, setSelected] = useState<Target | null>(null)
  const [, setVersion] = useState(0)
  const [inject, setInject] = useState<{ cmd: string; n: number }>()
  const [tab, setTab] = useState<'evidence' | 'mentor' | 'brief'>('brief')

  useEffect(() => save(c.id, { tags, shown, started, chat }), [c.id, tags, shown, started, chat])

  // A restored session remembers how many hints were revealed, but the text lives on the server now, so refetch it.
  // Re-reading an index below the counter is free on the server, so this does not inflate the help penalty.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || !shown || hints.length) return
    restored.current = true
    let dead = false
    Promise.all(Array.from({ length: shown }, (_, i) => fetchHint(c.id, i).then((r) => r.hint).catch(() => null)))
      .then((got) => {
        if (!dead) setHints(got.filter((x): x is string => x !== null))
      })
      .catch(() => undefined)
    return () => {
      dead = true
    }
  }, [c.id, shown, hints.length])

  const ctx = useMemo<Ctx>(
    () => ({
      disk,
      cwd: '/',
      recovered: new Map(),
      onFlsDeleted: () => setReveal(true),
      onRecovered: () => setVersion((v) => v + 1),
      onOpen: (t) => setSelected(t),
      onTag: (t, sha) => {
        if (tagsRef.current.some((x) => x.sha === sha)) return C.amber('Already on the evidence board (same SHA-256).')
        const cands = candidates(disk, t)
        // Derived inside the updater, so two tags in the same tick cannot both pass the dedup guard.
        let added = false
        setTags((ts) => {
          if (ts.some((x) => x.sha === sha)) return ts
          added = true
          return [...ts, { sha, name: t.path.split('/').pop()!, source: t.source, candidates: cands, t: null }]
        })
        if (!added) return C.amber('Already on the evidence board (same SHA-256).')
        setTab((cur) => (cur === 'evidence' ? cur : 'evidence'))
        return C.green(`Tagged ${t.path}\nsha256 ${sha}\n`) + C.dim('Placed on the evidence timeline. Drag it into order and pick its true timestamp.')
      },
    }),
    [disk],
  )
  const exec = useCallback((cmd: string) => setInject((p) => ({ cmd, n: (p?.n ?? 0) + 1 })), [])

  const mentorCtx = useCallback(
    (): MentorCtx => ({
      cwd: ctx.cwd,
      commands: log.current,
      recovered: [...ctx.recovered].map(([n, r]) => `/recovered/${n} (${r.source})`),
      tagged: tags.map((t) => `${t.name}: ${t.t !== null ? `time chosen ${fmtTime(t.t)}` : 'no time chosen yet'}`),
      shas: tags.map((t) => t.sha),
    }),
    [ctx, tags],
  )

  const submit = () => {
    const unset = tags.filter((t) => t.t === null).length
    if (!confirm(`Submit your findings?${unset ? `\n${unset} item(s) have no timestamp chosen.` : ''}`)) return
    onSubmit(
      {
        tagged: tags.map((t) => t.sha),
        // 'custom' names no field, so it is sent as absent: a hand-typed time cannot be the wrong field.
        timeline: tags.map((t) => ({ sha: t.sha, t: t.t, source: t.pick && t.pick !== 'custom' ? t.pick : undefined })),
        hints: shown,
        questions: chat.length,
      },
      tags,
      Date.now() - started,
    )
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([disk.bytes as BlobPart], { type: 'application/octet-stream' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${c.label}.img`
    document.body.appendChild(a) // Firefox ignores a detached anchor, and Chrome needs the URL alive past click()
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const banner = useMemo(
    () =>
      [
        `\x1b[33m${c.title.toUpperCase()}\x1b[0m  \x1b[90m· volume ${disk.label} · CarveFS · ${disk.bytes.length / 1024} KiB\x1b[0m`,
        `\x1b[90mType \x1b[33mhelp\x1b[90m for commands. Start with \x1b[33mfls -r -d /\x1b[90m to list deleted files.\x1b[0m`,
        `\x1b[90mCopy: select + Ctrl+Shift+C (or right-click). Paste: Ctrl+V. Pasting several lines runs them in order.\x1b[0m`,
        '',
      ].join('\n'),
    [c, disk],
  )

  const revealHint = async () => {
    setHintErr(null)
    try {
      const { hint } = await fetchHint(c.id, shown)
      setHints((h) => [...h, hint])
      setShown((s) => s + 1)
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) return setNoHints(true)
      setHintErr(e instanceof Error ? e.message : 'Could not reach the server for a hint.')
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-bg p-8 text-center lg:hidden">
        <p className="max-w-sm text-mute">The investigation workspace needs a screen at least 1024px wide: a terminal, a file explorer and a hex viewer side by side.</p>
        <button onClick={onExit} className="rounded-md border border-line px-4 py-2 text-sm">
          Back to cases
        </button>
      </div>
      {/* `hidden` matters: the overlay only covers the workspace, so without it the terminal, explorer and hex viewer
          stay in the DOM and reachable by Tab and by screen readers on a phone. */}
      <div className="hidden h-full grid-rows-[48px_1fr] overflow-hidden lg:grid">
        <header className="flex items-center gap-4 border-b border-line bg-panel px-4">
          <button onClick={onExit} className="font-mono text-sm font-bold tracking-widest text-amber" title="Back to cases">
            CARVE
          </button>
          <span className="text-faint" aria-hidden>
            /
          </span>
          <h1 className="text-sm font-medium">{c.title}</h1>
          <Difficulty d={c.difficulty} />
          <div className="ml-auto flex items-center gap-3 text-xs">
            <Timer since={started} />
            <span
              className={`font-mono ${shown + chat.length ? 'text-amber' : 'text-mute'}`}
              title={`${shown} hint(s) × ${W.hint} + ${chat.length} mentor question(s) × ${W.question}`}
            >
              {shown + chat.length ? `help used: −${shown * W.hint + chat.length * W.question} pts` : 'no help used'}
            </span>
            <button onClick={download} className="inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 text-mute hover:text-ink" title="The raw CarveFS disk image. Open it in any hex editor.">
              <DownloadSimple aria-hidden /> {c.label}.img
            </button>
            <button onClick={submit} disabled={!tags.length} className="rounded bg-amber px-3 py-1.5 font-semibold text-black hover:brightness-110 disabled:opacity-50">
              Submit findings
            </button>
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)_380px]">
          <aside aria-label="File explorer" className="min-h-0 overflow-auto border-r border-line bg-panel">
            <Explorer ctx={ctx} reveal={reveal} onToggleReveal={() => setReveal((r) => !r)} onSelect={setSelected} exec={exec} selected={selected?.path} />
          </aside>

          <main className="grid min-h-0 min-w-0 grid-rows-[3fr_2fr]">
            <div className="min-h-0 overflow-hidden bg-bg">
              <Terminal
                ctx={ctx}
                banner={banner}
                onRan={(cmd, out) => {
                  // oxlint-disable-next-line no-control-regex -- stripping the terminal's own colour escapes
                  if (cmd.trim()) log.current = [...log.current, { cmd, out: out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(0, 700) }].slice(-20)
                  if (out) setVersion((v) => v + 1) // an empty Enter used to force a full re-render
                }}
                inject={inject}
              />
            </div>
            <Viewer t={selected} disk={disk} exec={exec} />
          </main>

          <aside aria-label="Case information" className="grid min-h-0 grid-rows-[auto_1fr] border-l border-line bg-panel">
            <div role="tablist" aria-label="Case panels" className="flex border-b border-line text-sm">
              {(
                [
                  ['brief', 'Case brief', 'panel-brief'],
                  ['evidence', `Evidence ${tags.length ? `(${tags.length})` : ''}`, 'panel-evidence'],
                  ['mentor', 'Mentor', 'panel-mentor'],
                ] as const
              ).map(([k, label, id]) => (
                <button
                  key={k}
                  role="tab"
                  id={id}
                  aria-selected={tab === k}
                  aria-controls="panel"
                  onClick={() => setTab(k)}
                  className={`flex-1 px-3 py-2.5 ${tab === k ? 'border-b-2 border-amber text-ink' : 'text-mute hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id="panel" aria-labelledby={`panel-${tab}`} className="min-h-0 overflow-auto">
              <Crash>
                {tab === 'brief' && <Brief c={c} />}
                {tab === 'evidence' && <Board tags={tags} setTags={setTags} />}
                {tab === 'mentor' && (
                  <Mentor
                    caseId={c.id}
                    hints={hints}
                    shown={shown}
                    hintErr={hintErr}
                    noHints={noHints}
                    onRetryHint={() => setHintErr(null)}
                    onHint={revealHint}
                    chat={chat}
                    context={mentorCtx}
                    onAsk={(q, a) => setChat((ch) => [...ch, { q, a }].slice(-20))}
                  />
                )}
              </Crash>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}

/** Its own component so the once-a-second tick re-renders one span instead of the whole workspace. */
function Timer({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return (
    <span className="inline-flex items-center gap-1 font-mono text-mute" title="Time on case">
      <TimerIcon aria-hidden /> {String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}
    </span>
  )
}

/* ---------------- Explorer ---------------- */

type TreeEnv = { ctx: Ctx; reveal: boolean; onSelect: (t: Target) => void; exec: (c: string) => void; selected?: string }

const TreeRow = memo(function TreeRow({ ino, name, path, depth, deleted, env }: { ino: number; name: string; path: string; depth: number; deleted?: boolean; env: TreeEnv }) {
  const { ctx: { disk }, reveal, onSelect, exec, selected } = env
  const n = disk.inode(ino)
  const [open, setOpen] = useState(depth < 3)
  const hidden = name.startsWith('.') || n.hidden
  if (n.mode === 'dir' && !deleted) {
    const kids = [
      ...disk.readDir(ino).map((e) => ({ ...e, path: `${path === '/' ? '' : path}/${e.name}`, deleted: false })),
      ...(reveal ? disk.inodes().filter((x) => x.deleted && x.parent === ino).map((x) => ({ ino: x.ino, name: x.name, path: `${path === '/' ? '' : path}/${x.name}`, deleted: true })) : []),
    ]
    return (
      <div>
        <button aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-2 py-0.5 text-left hover:bg-raised" style={{ paddingLeft: 8 + depth * 12 }}>
          <span className="w-3 text-faint">{open ? <CaretDown size={11} aria-hidden /> : <CaretRight size={11} aria-hidden />}</span>
          <span className={hidden ? 'text-info/80' : 'text-info'}>{name}/</span>
        </button>
        {open && kids.map((k) => <TreeRow key={`${k.ino}-${k.deleted}`} {...k} depth={depth + 1} env={env} />)}
      </div>
    )
  }
  const openFile = () => {
    if (deleted) exec(`istat ${ino}`)
    else onSelect({ path, bytes: disk.read(ino), ino, source: `inode ${ino}` })
  }
  return (
    <div className={`group flex items-center gap-1.5 px-2 py-0.5 hover:bg-raised ${selected === path ? 'bg-raised' : ''}`} style={{ paddingLeft: 20 + depth * 12 }}>
      <button onClick={openFile} className={`min-w-0 flex-1 truncate text-left ${deleted ? 'text-bad line-through decoration-bad/80' : hidden ? 'text-mute' : ''}`} title={deleted ? `Deleted: inode ${ino}. Click for istat` : path}>
        {name}
      </button>
      {deleted && disk.overwritten(ino).length > 0 && <CircleHalf size={12} className="shrink-0 text-bad" role="img" aria-label="Blocks reallocated: partial recovery" />}
      {deleted ? (
        <button onClick={() => exec(`icat ${ino}`)} className="text-[11px] text-amber opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100" title={`icat ${ino}`}>
          recover<span className="sr-only"> deleted file {name} (inode {ino})</span>
        </button>
      ) : (
        <button onClick={() => exec(`tag ${path}`)} className="text-[11px] text-amber opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100" title={`tag ${path}`}>
          tag<span className="sr-only"> {name} as evidence</span>
        </button>
      )}
    </div>
  )
})

const Explorer = memo(function Explorer({ ctx, reveal, onToggleReveal, onSelect, exec, selected }: TreeEnv & { onToggleReveal: () => void }) {
  // One inode table for the whole tree, instead of a 63-inode parse per deleted row per render.
  const all = useMemo(() => ctx.disk.inodes(), [ctx.disk])
  const overwritten = useMemo(() => new Map(all.map((n) => [n.ino, ctx.disk.overwritten(n.ino).length > 0])), [all, ctx.disk])
  const env = useMemo<TreeEnv>(() => ({ ctx, reveal, onSelect, exec, selected }), [ctx, reveal, onSelect, exec, selected])
  return (
    <div className="py-2 font-mono text-[12.5px]">
      <div className="flex items-center justify-between px-3 pb-2 font-sans text-[11px] uppercase tracking-wider text-faint">
        <span>Explorer</span>
        <label className="flex items-center gap-1.5 normal-case tracking-normal" title="Normally revealed by running fls -d">
          <input type="checkbox" checked={reveal} onChange={onToggleReveal} className="accent-amber" /> show deleted
        </label>
      </div>
      <TreeRow ino={ROOT} name="" path="/" depth={0} env={env} />
      <div className="mt-3 border-t border-line px-3 pt-2 font-sans text-[11px] uppercase tracking-wider text-faint">{RECOVERED}</div>
      {ctx.recovered.size === 0 && <p className="px-3 py-1 font-sans text-xs text-faint">Nothing yet. icat or carve files to recover them here.</p>}
      {[...ctx.recovered].map(([name, r]) => {
        const path = `${RECOVERED}/${name}`
        return (
          <div key={name} className={`group flex items-center gap-1.5 px-3 py-0.5 hover:bg-raised ${selected === path ? 'bg-raised' : ''}`}>
            <button onClick={() => onSelect({ path, bytes: r.bytes, source: r.source, ino: r.ino })} className="min-w-0 flex-1 truncate text-left text-ok" title={r.source}>
              {name}
            </button>
            <button onClick={() => exec(`tag ${path}`)} className="text-[11px] text-amber opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100">
              tag<span className="sr-only"> {name} as evidence</span>
            </button>
          </div>
        )
      })}
      <span className="sr-only" aria-live="polite">
        {reveal ? 'Deleted files are now shown in the explorer.' : ''}
      </span>
      {overwritten.size === 0 && null}
    </div>
  )
})

/* ---------------- Viewer ---------------- */

const Viewer = memo(function Viewer({ t, disk, exec }: { t: Target | null; disk: Loaded['disk']; exec: (c: string) => void }) {
  const img = useBlobUrl(t && sniff(t.bytes).startsWith('JPEG') ? t.bytes : null)
  // Format parsing walks the whole buffer (readDocx scans backwards twice), so it must not run on every render.
  const parsed = useMemo(() => {
    if (!t) return null
    const kind = sniff(t.bytes)
    return { kind, exif: readExif(t.bytes), doc: readDocx(t.bytes), text: /ASCII|script/.test(kind) ? td.decode(t.bytes) : null, n: t.ino ? disk.inode(t.ino) : null }
  }, [t, disk])
  if (!t || !parsed) return <div className="flex items-center justify-center border-t border-line bg-panel text-sm text-faint">Select a file in the explorer, or run <code className="mx-1 font-mono text-amber">open &lt;file&gt;</code>, to inspect it here.</div>
  const { kind, exif, doc, text, n } = parsed
  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[auto_1fr] overflow-hidden border-t border-line bg-panel">
      <div className="flex min-w-0 items-center gap-3 whitespace-nowrap border-b border-line px-3 py-1.5 text-xs">
        <span className="min-w-0 truncate font-mono text-ink" title={t.path}>
          {t.path}
        </span>
        <span className="shrink-0 text-faint">
          {kind.split(',')[0]}, {t.bytes.length} B
        </span>
        <span className="min-w-0 truncate text-faint" title={t.source}>
          {t.source}
        </span>
        <div className="ml-auto flex shrink-0 gap-3">
          {t.ino && (
            <button onClick={() => exec(`istat ${t.ino}`)} className="text-amber hover:underline">
              istat<span className="sr-only"> {t.path}</span>
            </button>
          )}
          <button onClick={() => exec(`tag ${t.path}`)} className="text-amber hover:underline">
            Tag<span className="sr-only"> {t.path} as evidence</span>
          </button>
        </div>
      </div>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-h-0 overflow-auto border-r border-line p-3 text-xs">
          {img && <img src={img} alt={t.path} className="mb-3 max-h-40 rounded border border-line" style={{ imageRendering: 'pixelated' }} />}
          {exif && <KV rows={exif} />}
          {doc && (
            <>
              <KV rows={doc.meta} />
              <pre className="mt-2 whitespace-pre-wrap font-mono text-mute">{doc.text}</pre>
            </>
          )}
          {text !== null && <pre className="whitespace-pre-wrap break-all font-mono text-[11.5px] leading-relaxed">{text}</pre>}
          {!img && !exif && !doc && text === null && n && <KV rows={[['B', fmtTime(n.btime)], ['M', fmtTime(n.mtime)], ['A', fmtTime(n.atime)], ['C', fmtTime(n.ctime)]]} />}
          {!img && !exif && !doc && text === null && !n && <p className="text-faint">Binary data. See the hex view.</p>}
        </div>
        <Hex bytes={t.bytes} />
      </div>
    </div>
  )
})

/** Object URL as state, because creating one inside useMemo is a side effect during render and leaks under StrictMode. */
function useBlobUrl(bytes: Uint8Array | null) {
  const [made, setMade] = useState<{ for: Uint8Array | null; url: string } | null>(null)
  useEffect(() => {
    if (!bytes) return
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
    // oxlint-disable-next-line react/set-state-in-effect -- an object URL is an external resource, so it cannot be derived during render without leaking one per render
    setMade({ for: bytes, url })
    return () => URL.revokeObjectURL(url)
  }, [bytes])
  return made?.for === bytes ? made.url : null
}

function KV({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full font-mono text-[11.5px]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="pr-3 align-top text-amber">{k}</td>
            <td className="break-words">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const MAGICS = [[0xff, 0xd8, 0xff], [0xff, 0xd9], [0x50, 0x4b, 3, 4], [0x50, 0x4b, 5, 6], [0x25, 0x50, 0x44, 0x46]]

const Hex = memo(function Hex({ bytes }: { bytes: Uint8Array }) {
  const limit = Math.min(bytes.length, 4096)
  const rows = useMemo(() => {
    // Mark signature bytes (JPEG SOI/EOI, ZIP local/EOCD, %PDF) so hidden structure stands out.
    const m = new Uint8Array(limit)
    for (let i = 0; i < limit; i++)
      for (const sig of MAGICS) if (sig.every((b, j) => bytes[i + j] === b)) for (let j = 0; j < sig.length && i + j < limit; j++) m[i + j] = 1
    const out: React.ReactNode[] = []
    for (let o = 0; o < limit; o += 16) {
      const row = [...bytes.subarray(o, Math.min(o + 16, limit))]
      out.push(
        <div key={o} className="whitespace-pre">
          <span className="text-faint">{o.toString(16).padStart(6, '0')} </span>
          {row.map((b, i) => (
            <span key={i} className={m[o + i] ? 'bg-amber/20 text-amber' : ''}>
              {' ' + b.toString(16).padStart(2, '0')}
            </span>
          ))}
          <span className="text-faint">{'   '.repeat(16 - row.length)}  </span>
          <span className="text-[#56d4dd]">{row.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')}</span>
        </div>,
      )
    }
    return out
  }, [bytes, limit])
  return (
    <div className="min-h-0 overflow-auto p-3 font-mono text-[11px] leading-[1.45]">
      {rows}
      {bytes.length > limit && <div className="mt-1 text-faint">… {bytes.length - limit} more bytes (use hexdump -s in the terminal)</div>}
    </div>
  )
})

/* ---------------- Evidence board + timeline ---------------- */

const Board = memo(function Board({ tags, setTags }: { tags: Tag[]; setTags: React.Dispatch<React.SetStateAction<Tag[]>> }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = tags.findIndex((t) => t.sha === e.active.id)
    const to = tags.findIndex((t) => t.sha === e.over!.id)
    if (from < 0 || to < 0) return
    setTags((ts) => arrayMove(ts, from, to))
  }
  const update = useCallback((sha: string, t: number | null, pick?: string) => setTags((ts) => ts.map((x) => (x.sha === sha ? { ...x, t, pick } : x))), [setTags])
  if (!tags.length)
    return (
      <div className="p-5 text-sm leading-relaxed text-mute">
        <p className="mb-2 font-medium text-ink">No evidence tagged yet.</p>
        <p>
          Recover files, then run <code className="font-mono text-amber">tag &lt;file&gt;</code> or hover a file and click <span className="text-amber">tag</span>. Each item is identified by its SHA-256, as in a real case file.
        </p>
      </div>
    )
  return (
    <div className="p-3">
      <p className="mb-3 text-xs leading-relaxed text-mute">
        Drag into <span className="text-ink">chronological order</span> (earliest first), then choose each event's <span className="text-ink">true UTC time</span>. Some timestamps have been forged or are in local time, so pick the field you actually trust.
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up ${labelOf(tags, active.id)}.`,
            onDragOver: ({ over }) => (over ? `Over ${labelOf(tags, over.id)}.` : 'Not over a droppable area.'),
            onDragEnd: ({ over }) => (over ? `Dropped over ${labelOf(tags, over.id)}.` : 'Dropped outside the board.'),
            onDragCancel: () => 'Reorder cancelled.',
          },
        }}
      >
        <SortableContext items={tags.map((t) => t.sha)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {tags.map((t, i) => (
              <Card key={t.sha} tag={t} i={i} onTime={(v, pick) => update(t.sha, v, pick)} onRemove={() => setTags((ts) => ts.filter((x) => x.sha !== t.sha))} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p className="sr-only" role="status" aria-live="polite">
        {`${tags.length} evidence items on the board, ordered earliest first.`}
      </p>
    </div>
  )
})

const labelOf = (tags: Tag[], id: string | number) => tags.find((t) => t.sha === id)?.name ?? 'item'

const Card = memo(function Card({ tag, i, onTime, onRemove }: { tag: Tag; i: number; onTime: (t: number | null, pick?: string) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tag.sha })
  const idx = tag.candidates.findIndex((c: Candidate) => c.label === tag.pick)
  const custom = tag.pick === 'custom'
  const iso = tag.t !== null ? new Date(tag.t * 1000).toISOString().slice(0, 19) : ''
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`rounded border bg-raised ${isDragging ? 'z-10 border-amber shadow-lg' : 'border-line'}`}>
      <div className="flex items-start gap-2 p-2.5">
        <button {...attributes} {...listeners} className="mt-0.5 cursor-grab touch-none px-1 font-mono text-faint hover:text-ink active:cursor-grabbing" aria-label={`Reorder ${tag.name}`}>
          <DotsSixVertical size={16} aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-faint">{String(i + 1).padStart(2, '0')}</span>
            <span className="truncate font-mono text-[13px]">{tag.name}</span>
          </div>
          <div className="truncate text-[11px] text-faint" title={tag.source}>
            {tag.source} · <span title={tag.sha}>{tag.sha.slice(0, 12)}…</span>
          </div>
          <select
            value={custom ? 'custom' : idx >= 0 ? String(idx) : ''}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'custom') onTime(tag.t, 'custom')
              else if (v === '') onTime(null)
              else onTime(tag.candidates[Number(v)]!.t, tag.candidates[Number(v)]!.label)
            }}
            className="mt-2 w-full rounded border border-line bg-bg px-2 py-1 font-mono text-[11px]"
            aria-label={`Timestamp for ${tag.name}`}
          >
            <option value="">Choose the true time of this event…</option>
            {tag.candidates.map((c, k) => (
              <option key={k} value={k}>
                {describe(c)}
              </option>
            ))}
            <option value="custom">Enter a time manually (UTC)…</option>
          </select>
          {custom && (
            <>
              <input
                type="datetime-local"
                step={1}
                value={iso}
                onChange={(e) => onTime(e.target.value ? Math.floor(Date.parse(e.target.value + 'Z') / 1000) : null, 'custom')}
                className="mt-1.5 w-full rounded border border-line bg-bg px-2 py-1 font-mono text-[11px]"
                aria-label={`Custom UTC time for ${tag.name}, format year-month-day hour minute second`}
              />
              {/* Safari ignores step={1} on datetime-local, and the scoring tolerance is ±60s, so seconds must be typeable. */}
              <input
                value={iso}
                onChange={(e) => {
                  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(e.target.value)
                  onTime(m ? Math.floor(Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}Z`) / 1000) : null, 'custom')
                }}
                placeholder="YYYY-MM-DD HH:MM:SS UTC"
                className="mt-1.5 w-full rounded border border-line bg-bg px-2 py-1 font-mono text-[11px]"
                aria-label={`Or type the UTC time for ${tag.name} as year, month, day, hour, minute, second`}
              />
            </>
          )}
        </div>
        <button onClick={onRemove} className="px-1 text-faint hover:text-bad" aria-label={`Remove ${tag.name} from the evidence board`}>
          <X size={14} aria-hidden />
        </button>
      </div>
    </li>
  )
})

/* ---------------- Brief ---------------- */

function Brief({ c }: { c: Loaded['meta'] }) {
  return (
    <div className="space-y-4 p-4 text-sm leading-relaxed">
      <div className="space-y-2 text-ink/90">
        {c.brief.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div>
        <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Objectives</h2>
        <ul className="list-disc space-y-1 pl-5 text-mute">
          {c.objectives.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      </div>
      <div className="rounded border border-line bg-bg p-3 text-xs text-mute">
        <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Scoring</h2>
        {W.recovery} recovery · {W.order} timeline order · {W.time} timestamp accuracy (±{W.tolerance} s, read from the right field) · {W.precision} precision.{' '}
        <span className="text-bad">−{W.decoy}</span> per decoy tagged, <span className="text-bad">−{W.hint}</span> per hint, <span className="text-bad">−{W.question}</span> per mentor question. Not every deleted or hidden file is evidence.
      </div>
      <div className="rounded border border-line bg-bg p-3 font-mono text-xs text-mute">
        <div className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wider text-faint">Basic commands (free)</div>
        <div className="mb-2 font-sans text-[12px] text-faint">The same 4 moves work in every case. Hints in the Mentor tab are clues about this specific case.</div>
        <div>
          <span className="text-amber">fls -r -d /</span> list deleted files and their inode numbers
        </div>
        <div>
          <span className="text-amber">icat &lt;number&gt;</span> recover one, e.g. icat 4
        </div>
        <div>
          <span className="text-amber">cat /recovered/…</span> read what you recovered
        </div>
        <div>
          <span className="text-amber">tag /recovered/…</span> add it to the evidence timeline
        </div>
      </div>
    </div>
  )
}

/* ---------------- Mentor ---------------- */

const STARTERS = ['What should I do next?', 'Explain what my last command showed', 'Which timestamp should I trust?', 'What is an inode?']

const Mentor = memo(function Mentor({
  caseId,
  hints,
  shown,
  hintErr,
  noHints,
  onRetryHint,
  onHint,
  chat,
  context,
  onAsk,
}: {
  caseId: string
  hints: string[]
  shown: number
  hintErr: string | null
  noHints: boolean
  onRetryHint: () => void
  onHint: () => void
  chat: Chat
  context: () => MentorCtx
  onAsk: (q: string, a: string) => void
}) {
  const [q, setQ] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [hintsOpen, setHintsOpen] = useState(shown > 0)
  const [degraded, setDegraded] = useState(false)
  // Scroll only the chat box (scrollIntoView can also scroll the page's outer containers).
  const box = useRef<HTMLDivElement>(null)
  const live = useRef(0)
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [chat.length, pending])

  const ask = async (text: string) => {
    const question = text.trim()
    if (!question || pending) return
    setQ('')
    setPending(question)
    const history = chat.slice(-8).flatMap((m) => [
      { role: 'user' as const, content: m.q },
      { role: 'assistant' as const, content: m.a },
    ])
    // The trainee paid for this answer, so a reply that lands after they left the tab is spent either way: bail
    // rather than setState on an unmounted tree, and let the next question supersede a slow one.
    const mine = ++live.current
    const r = await askMentor({ caseId, mode: 'hint', question, history, context: context() }).catch(() => null)
    if (mine !== live.current) return
    onAsk(question, r?.answer || "I couldn't reach the AI just now. Reveal a written hint instead, or keep working with `fls -r -d /` and `icat`.")
    setDegraded(!!r?.degraded)
    setPending(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-4 py-3">
        <button aria-expanded={hintsOpen} onClick={() => setHintsOpen((o) => !o)} className="flex w-full items-center gap-2 text-left text-[13px]">
          <Lightbulb className="text-amber" aria-hidden />
          <span className="font-medium">Written hints</span>
          <span className="text-faint">
            {shown} used, −{W.hint} each
          </span>
          <span className="ml-auto text-faint">{hintsOpen ? <CaretDown aria-hidden /> : <CaretRight aria-hidden />}</span>
        </button>
        {hintsOpen && (
          <div className="mt-3 space-y-2">
            {hints.map((h, i) => (
              <div key={i} className="rounded-md border border-line bg-bg px-3 py-2 text-[13px] leading-relaxed text-mute">
                <span className="mr-1.5 font-mono text-[11px] text-amber">{i + 1}.</span>
                <Md s={h} inline />
              </div>
            ))}
            {hintErr && (
              <div role="alert" className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-xs text-ink">
                {hintErr}{' '}
                <button onClick={onRetryHint} className="underline">
                  Dismiss
                </button>
              </div>
            )}
            <button onClick={onHint} disabled={noHints} className="w-full rounded-md border border-amber/40 py-1.5 text-xs text-amber hover:bg-amber/10 disabled:opacity-60">
              {noHints ? 'No more hints for this case' : `Reveal hint ${shown + 1} (−${W.hint} pts)`}
            </button>
          </div>
        )}
      </div>

      <div ref={box} aria-live="polite" aria-busy={!!pending} className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
        {chat.length === 0 && !pending && (
          <div className="rounded-md border border-line bg-bg p-4 text-[13px] leading-relaxed text-mute">
            <p className="font-medium text-ink">Your AI investigation mentor</p>
            <p className="mt-1.5">It can see the commands you ran and their output, the files you recovered, and your evidence board. Ask anything, even basic questions. Each question costs {W.question} points.</p>
          </div>
        )}
        {chat.map((m, i) => (
          <Turn key={i} q={m.q} a={m.a} />
        ))}
        {pending && <Turn q={pending} a={null} />}
      </div>
      {degraded && <p className="border-t border-line px-4 py-1.5 text-[11px] text-faint">The mentor is on its free fallback model, so answers are more basic than usual.</p>}

      <div className="border-t border-line p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {STARTERS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={!!pending} className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-mute hover:border-amber/60 hover:text-ink disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(q)
          }}
          className="flex items-end gap-2 rounded-md border border-line bg-bg p-1.5 focus-within:border-amber/60"
        >
          <textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ask(q)
              }
            }}
            rows={2}
            placeholder="Ask the mentor…"
            aria-label="Ask the mentor"
            className="min-h-[40px] flex-1 resize-none bg-transparent px-1 py-1 text-[13px] placeholder:text-faint focus:outline-none focus-visible:outline-none"
          />
          <button type="submit" disabled={!!pending || !q.trim()} className="grid h-8 w-8 place-items-center rounded bg-amber text-bg disabled:opacity-50" aria-label="Send question">
            <ArrowUp weight="bold" aria-hidden />
          </button>
        </form>
        <p className="mt-1.5 text-[11px] text-faint">
          Enter to send, Shift+Enter for a new line. −{W.question} pts per question.
        </p>
      </div>
    </div>
  )
})


function Turn({ q, a }: { q: string; a: string | null }) {
  return (
    <div className="space-y-2">
      <div className="ml-8 rounded-md rounded-br-sm bg-amber/10 px-3 py-2 text-[13px] text-ink">{q}</div>
      <div className="mr-4">
        <div className="mb-1 font-mono text-[10.5px] uppercase tracking-wider text-amber">Mentor</div>
        {a === null ? (
          <div className="flex items-center gap-2 text-[13px] text-mute">
            <span className="h-1.5 w-1.5 motion-safe:animate-pulse rounded-full bg-amber" />
            Reading your session…
          </div>
        ) : (
          <div className="text-[13px] leading-relaxed text-ink/90">
            <Md s={a} />
          </div>
        )}
      </div>
    </div>
  )
}
