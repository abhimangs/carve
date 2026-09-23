import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CaretDown, CaretRight, CircleHalf, DotsSixVertical, DownloadSimple, Timer, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Loaded } from '../cases'
import { fmtTime, td } from '../fs/bytes'
import { readDocx, readExif, sniff } from '../fs/formats'
import { ROOT } from '../fs/reader'
import { type Candidate, type Tag, candidates, describe } from '../evidence'
import { C, type Ctx, RECOVERED, type Target } from '../term/commands'
import type { Submission } from '../score'
import Terminal from './Terminal'

type Saved = { tags: Tag[]; hints: number; shown: number; started: number; chat: { q: string; a: string }[] }
const load = (id: string): Saved | null => {
  try {
    return JSON.parse(localStorage.getItem(`carve:${id}`) ?? 'null')
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
  const { c, disk, key } = loaded
  const init = useMemo(() => load(c.id), [c.id])
  const [tags, setTags] = useState<Tag[]>(init?.tags ?? [])
  const [hints, setHints] = useState(init?.hints ?? 0)
  const [shown, setShown] = useState(init?.shown ?? 0)
  const [chat, setChat] = useState(init?.chat ?? [])
  const [started] = useState(init?.started ?? Date.now())
  const [reveal, setReveal] = useState(false)
  const [selected, setSelected] = useState<Target | null>(null)
  const [, setVersion] = useState(0)
  const [inject, setInject] = useState<{ cmd: string; n: number }>()
  const [tab, setTab] = useState<'evidence' | 'mentor' | 'brief'>('brief')
  const tagsRef = useRef(tags)
  tagsRef.current = tags

  useEffect(() => save(c.id, { tags, hints, shown, started, chat }), [c.id, tags, hints, shown, started, chat])

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
        setTags((ts) => [...ts, { sha, name: t.path.split('/').pop()!, source: t.source, candidates: cands, t: null }])
        setTab('evidence')
        return C.green(`Tagged ${t.path}\nsha256 ${sha}\n`) + C.dim('Placed on the evidence timeline. Drag it into order and pick its true timestamp.')
      },
    }),
    [disk],
  )
  const exec = (cmd: string) => setInject((p) => ({ cmd, n: (p?.n ?? 0) + 1 }))

  const elapsed = useElapsed(started)
  const found = key.evidence.filter((e) => tags.some((t) => t.sha === e.sha))

  const submit = () => {
    const unset = tags.filter((t) => t.t === null).length
    if (!confirm(`Submit your findings?${unset ? `\n${unset} item(s) have no timestamp chosen.` : ''}`)) return
    onSubmit({ tagged: tags.map((t) => t.sha), timeline: tags.map((t) => ({ sha: t.sha, t: t.t })), hints }, tags, Date.now() - started)
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([disk.bytes as BlobPart], { type: 'application/octet-stream' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `${c.label}.img` })
    a.click()
    URL.revokeObjectURL(url)
  }

  const banner = [
    `\x1b[33m${c.title.toUpperCase()}\x1b[0m  \x1b[90m· volume ${disk.label} · CarveFS · ${disk.bytes.length / 1024} KiB\x1b[0m`,
    `\x1b[90mType \x1b[33mhelp\x1b[90m for commands. Start with \x1b[33mls -la /\x1b[90m, then look for what was deleted.\x1b[0m`,
    '',
  ].join('\n')

  return (
    <>
    <div className="fixed inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-bg p-8 text-center lg:hidden">
      <p className="max-w-sm text-mute">The investigation workspace needs a screen at least 1024px wide: a terminal, a file explorer and a hex viewer side by side.</p>
      <button onClick={onExit} className="rounded-md border border-line px-4 py-2 text-sm">Back to cases</button>
    </div>
    <div className="grid h-full grid-rows-[48px_1fr] overflow-hidden">
      <header className="flex items-center gap-4 border-b border-line bg-panel px-4">
        <button onClick={onExit} className="font-mono text-sm font-bold tracking-widest text-amber" title="Back to cases">
          CARVE
        </button>
        <span className="text-faint">/</span>
        <span className="text-sm font-medium">{c.title}</span>
        <Difficulty d={c.difficulty} />
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1 font-mono text-mute" title="Time on case"><Timer /> {elapsed}</span>
          <span className="font-mono text-mute" title="Hint penalty">hints −{hints * 5}</span>
          <button onClick={download} className="inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 text-mute hover:text-ink" title="The raw CarveFS disk image. Open it in any hex editor.">
            <DownloadSimple /> {c.label}.img
          </button>
          <button onClick={submit} disabled={!tags.length} className="rounded bg-amber px-3 py-1.5 font-semibold text-black hover:brightness-110">
            Submit findings
          </button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)_380px]">
        <aside className="min-h-0 overflow-auto border-r border-line bg-panel">
          <Explorer ctx={ctx} reveal={reveal} onToggleReveal={() => setReveal((r) => !r)} onSelect={setSelected} exec={exec} selected={selected?.path} />
        </aside>

        <main className="grid min-h-0 min-w-0 grid-rows-[3fr_2fr]">
          <div className="min-h-0 overflow-hidden bg-bg">
            <Terminal ctx={ctx} banner={banner} onRan={() => setVersion((v) => v + 1)} inject={inject} />
          </div>
          <Viewer t={selected} disk={disk} exec={exec} />
        </main>

        <aside className="grid min-h-0 grid-rows-[auto_1fr] border-l border-line bg-panel">
          <nav className="flex border-b border-line text-sm">
            {(
              [
                ['brief', 'Case brief'],
                ['evidence', `Evidence ${tags.length ? `(${tags.length})` : ''}`],
                ['mentor', 'Mentor'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 px-3 py-2.5 ${tab === k ? 'border-b-2 border-amber text-ink' : 'text-mute hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 overflow-auto">
            {tab === 'brief' && <Brief loaded={loaded} />}
            {tab === 'evidence' && <Board tags={tags} setTags={setTags} />}
            {tab === 'mentor' && (
              <Mentor
                loaded={loaded}
                shown={shown}
                chat={chat}
                foundIds={found.map((e) => e.id)}
                onHint={() => {
                  setShown((s) => s + 1)
                  setHints((h) => h + 1)
                }}
                onAsk={(q, a) => {
                  setChat((ch) => [...ch, { q, a }])
                  setHints((h) => h + 1)
                }}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
    </>
  )
}

function useElapsed(since: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function Difficulty({ d }: { d: string }) {
  const color = d === 'Easy' ? 'text-ok border-ok/40' : d === 'Medium' ? 'text-amber border-amber/40' : 'text-bad border-bad/40'
  return <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${color}`}>{d}</span>
}

/* ---------------- Explorer ---------------- */

type TreeEnv = { ctx: Ctx; reveal: boolean; onSelect: (t: Target) => void; exec: (c: string) => void; selected?: string }

function TreeRow({ ino, name, path, depth, deleted, env }: { ino: number; name: string; path: string; depth: number; deleted?: boolean; env: TreeEnv }) {
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
        <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-2 py-0.5 text-left hover:bg-raised" style={{ paddingLeft: 8 + depth * 12 }}>
          <span className="w-3 text-faint">{open ? <CaretDown size={11} /> : <CaretRight size={11} />}</span>
          <span className={hidden ? 'text-info/60' : 'text-info'}>{name}/</span>
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
      <button onClick={openFile} className={`min-w-0 flex-1 truncate text-left ${deleted ? 'text-bad line-through decoration-bad/50' : hidden ? 'text-mute' : ''}`} title={deleted ? `Deleted: inode ${ino}. Click for istat` : path}>
        {name}
      </button>
      {deleted && disk.overwritten(ino).length > 0 && <CircleHalf size={12} className="text-bad" aria-label="Blocks reallocated: partial recovery" />}
      {deleted ? (
        <button onClick={() => exec(`icat ${ino}`)} className="text-[11px] text-amber opacity-0 group-hover:opacity-100" title={`icat ${ino}`}>
          recover
        </button>
      ) : (
        <button onClick={() => exec(`tag ${path}`)} className="text-[11px] text-amber opacity-0 group-hover:opacity-100" title={`tag ${path}`}>
          tag
        </button>
      )}
    </div>
  )
}

function Explorer({ ctx, reveal, onToggleReveal, onSelect, exec, selected }: TreeEnv & { onToggleReveal: () => void }) {

  return (
    <div className="py-2 font-mono text-[12.5px]">
      <div className="flex items-center justify-between px-3 pb-2 font-sans text-[11px] uppercase tracking-wider text-faint">
        <span>Explorer</span>
        <label className="flex items-center gap-1.5 normal-case tracking-normal" title="Normally revealed by running fls -d">
          <input type="checkbox" checked={reveal} onChange={onToggleReveal} className="accent-amber" /> show deleted
        </label>
      </div>
      <TreeRow ino={ROOT} name="" path="/" depth={0} env={{ ctx, reveal, onSelect, exec, selected }} />
      <div className="mt-3 border-t border-line px-3 pt-2 font-sans text-[11px] uppercase tracking-wider text-faint">{RECOVERED}</div>
      {ctx.recovered.size === 0 && <p className="px-3 py-1 font-sans text-xs text-faint">Nothing yet. icat or carve files to recover them here.</p>}
      {[...ctx.recovered].map(([name, r]) => {
        const path = `${RECOVERED}/${name}`
        return (
          <div key={name} className={`group flex items-center gap-1.5 px-3 py-0.5 hover:bg-raised ${selected === path ? 'bg-raised' : ''}`}>
            <button onClick={() => onSelect({ path, bytes: r.bytes, source: r.source, ino: r.ino })} className="min-w-0 flex-1 truncate text-left text-ok" title={r.source}>
              {name}
            </button>
            <button onClick={() => exec(`tag ${path}`)} className="text-[11px] text-amber opacity-0 group-hover:opacity-100">
              tag
            </button>
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- Viewer ---------------- */

function Viewer({ t, disk, exec }: { t: Target | null; disk: Loaded['disk']; exec: (c: string) => void }) {
  const img = useMemo(() => (t && sniff(t.bytes).startsWith('JPEG') ? URL.createObjectURL(new Blob([t.bytes as BlobPart], { type: 'image/jpeg' })) : null), [t])
  useEffect(() => () => void (img && URL.revokeObjectURL(img)), [img])
  if (!t) return <div className="flex items-center justify-center border-t border-line bg-panel text-sm text-faint">Select a file in the explorer, or run <code className="mx-1 font-mono text-amber">open &lt;file&gt;</code>, to inspect it here.</div>
  const kind = sniff(t.bytes)
  const exif = readExif(t.bytes)
  const doc = readDocx(t.bytes)
  const text = /ASCII|script/.test(kind) ? td.decode(t.bytes) : null
  const n = t.ino ? disk.inode(t.ino) : null
  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[auto_1fr] overflow-hidden border-t border-line bg-panel">
      <div className="flex min-w-0 items-center gap-3 whitespace-nowrap border-b border-line px-3 py-1.5 text-xs">
        <span className="min-w-0 truncate font-mono text-ink" title={t.path}>{t.path}</span>
        <span className="shrink-0 text-faint">{kind.split(',')[0]}, {t.bytes.length} B</span>
        <span className="min-w-0 truncate text-faint" title={t.source}>{t.source}</span>
        <div className="ml-auto flex shrink-0 gap-3">
          {t.ino && <button onClick={() => exec(`istat ${t.ino}`)} className="text-amber hover:underline">istat</button>}
          <button onClick={() => exec(`tag ${t.path}`)} className="text-amber hover:underline">Tag</button>
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

function Hex({ bytes }: { bytes: Uint8Array }) {
  const limit = Math.min(bytes.length, 4096)
  // Mark signature bytes (JPEG SOI/EOI, ZIP local/EOCD, %PDF) so hidden structure stands out.
  const mark = useMemo(() => {
    const m = new Uint8Array(limit)
    for (let i = 0; i < limit; i++)
      for (const sig of MAGICS) if (sig.every((b, j) => bytes[i + j] === b)) for (let j = 0; j < sig.length && i + j < limit; j++) m[i + j] = 1
    return m
  }, [bytes, limit])
  const rows = []
  for (let o = 0; o < limit; o += 16) {
    const row = [...bytes.subarray(o, Math.min(o + 16, limit))]
    rows.push(
      <div key={o} className="whitespace-pre">
        <span className="text-faint">{o.toString(16).padStart(6, '0')} </span>
        {row.map((b, i) => (
          <span key={i} className={mark[o + i] ? 'bg-amber/20 text-amber' : ''}>
            {' ' + b.toString(16).padStart(2, '0')}
          </span>
        ))}
        <span className="text-faint">{'   '.repeat(16 - row.length)}  </span>
        <span className="text-[#56d4dd]">{row.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')}</span>
      </div>,
    )
  }
  return (
    <div className="min-h-0 overflow-auto p-3 font-mono text-[11px] leading-[1.45]">
      {rows}
      {bytes.length > limit && <div className="mt-1 text-faint">… {bytes.length - limit} more bytes (use hexdump -s in the terminal)</div>}
    </div>
  )
}

/* ---------------- Evidence board + timeline ---------------- */

function Board({ tags, setTags }: { tags: Tag[]; setTags: React.Dispatch<React.SetStateAction<Tag[]>> }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    setTags((ts) => arrayMove(ts, ts.findIndex((t) => t.sha === e.active.id), ts.findIndex((t) => t.sha === e.over!.id)))
  }
  const update = (sha: string, t: number | null, pick?: string) => setTags((ts) => ts.map((x) => (x.sha === sha ? { ...x, t, pick } : x)))
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
        Drag into <span className="text-ink">chronological order</span> (earliest first), then choose each event's <span className="text-ink">true UTC time</span>. Some timestamps have been forged or are in local time.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tags.map((t) => t.sha)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {tags.map((t, i) => (
              <Card key={t.sha} tag={t} i={i} onTime={(v, pick) => update(t.sha, v, pick)} onRemove={() => setTags((ts) => ts.filter((x) => x.sha !== t.sha))} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function Card({ tag, i, onTime, onRemove }: { tag: Tag; i: number; onTime: (t: number | null, pick?: string) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tag.sha })
  const idx = tag.candidates.findIndex((c: Candidate) => c.label === tag.pick)
  const custom = tag.pick === 'custom'
  const iso = tag.t !== null ? new Date(tag.t * 1000).toISOString().slice(0, 19) : ''
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`rounded border bg-raised ${isDragging ? 'z-10 border-amber shadow-lg' : 'border-line'}`}>
      <div className="flex items-start gap-2 p-2.5">
        <button {...attributes} {...listeners} className="mt-0.5 cursor-grab touch-none px-1 font-mono text-faint hover:text-ink active:cursor-grabbing" aria-label={`Reorder ${tag.name}`}>
          <DotsSixVertical size={16} />
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
              else onTime(tag.candidates[Number(v)].t, tag.candidates[Number(v)].label)
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
            <input
              type="datetime-local"
              step={1}
              value={iso}
              onChange={(e) => onTime(e.target.value ? Math.floor(Date.parse(e.target.value + 'Z') / 1000) : null, 'custom')}
              className="mt-1.5 w-full rounded border border-line bg-bg px-2 py-1 font-mono text-[11px] [color-scheme:dark]"
              aria-label="Custom UTC time"
            />
          )}
        </div>
        <button onClick={onRemove} className="px-1 text-faint hover:text-bad" aria-label={`Remove ${tag.name}`}>
          <X size={14} />
        </button>
      </div>
    </li>
  )
}

/* ---------------- Brief ---------------- */

function Brief({ loaded }: { loaded: Loaded }) {
  const { c } = loaded
  return (
    <div className="space-y-4 p-4 text-sm leading-relaxed">
      <div className="space-y-2 text-ink/90">{c.brief.map((p, i) => <p key={i}>{p}</p>)}</div>
      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Objectives</h3>
        <ul className="list-disc space-y-1 pl-5 text-mute">{c.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
      </div>
      <div className="rounded border border-line bg-bg p-3 text-xs text-mute">
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Scoring</h3>
        40 recovery · 25 timeline order · 25 timestamp accuracy (±60 s) · 10 precision. <span className="text-bad">−3</span> per decoy tagged, <span className="text-bad">−5</span> per hint. Not every deleted or hidden file is evidence.
      </div>
      <div className="rounded border border-line bg-bg p-3 font-mono text-xs text-mute">
        <div className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wider text-faint">Workflow</div>
        <div><span className="text-amber">fls -r -d /</span> find deleted entries</div>
        <div><span className="text-amber">istat 17</span> read the inode's timestamps</div>
        <div><span className="text-amber">icat 17</span> recover to /recovered</div>
        <div><span className="text-amber">tag /recovered/…</span> add to the timeline</div>
      </div>
    </div>
  )
}

/* ---------------- Mentor ---------------- */

function Mentor({ loaded, shown, chat, foundIds, onHint, onAsk }: { loaded: Loaded; shown: number; chat: { q: string; a: string }[]; foundIds: string[]; onHint: () => void; onAsk: (q: string, a: string) => void }) {
  const { c } = loaded
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const ask = async () => {
    if (!q.trim() || busy) return
    setBusy(true)
    const a = await askMentor({ caseId: c.id, mode: 'hint', question: q, found: foundIds }).catch(() => null)
    onAsk(q, a ?? `Mentor offline. Static hint: ${c.hints[Math.min(shown, c.hints.length - 1)]}`)
    setQ('')
    setBusy(false)
  }
  return (
    <div className="space-y-4 p-4 text-sm">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Guided hints</h3>
          <button onClick={onHint} disabled={shown >= c.hints.length} className="rounded border border-amber/50 px-2 py-1 text-xs text-amber hover:bg-amber/10">
            Reveal next hint (−5)
          </button>
        </div>
        <ol className="space-y-2">
          {c.hints.slice(0, shown).map((h, i) => (
            <li key={i} className="rounded border border-line bg-bg p-2.5 text-[13px] leading-relaxed text-mute">
              <Md s={h} />
            </li>
          ))}
        </ol>
        {!shown && <p className="text-xs text-faint">{c.hints.length} hints available, from gentle to specific.</p>}
      </div>
      <div className="border-t border-line pt-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Ask the AI mentor (−5 per question)</h3>
        <div className="space-y-3">
          {chat.map((m, i) => (
            <div key={i} className="space-y-1.5">
              <p className="text-[13px] text-ink">› {m.q}</p>
              <p className="rounded border border-line bg-bg p-2.5 text-[13px] leading-relaxed text-mute whitespace-pre-wrap">
                <Md s={m.a} />
              </p>
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask()
          }}
          className="mt-3 flex gap-2"
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. How can I tell if a timestamp was faked?" className="min-w-0 flex-1 rounded border border-line bg-bg px-2.5 py-1.5 text-[13px]" />
          <button disabled={busy || !q.trim()} className="rounded bg-raised px-3 text-[13px] text-amber">
            {busy ? '…' : 'Ask'}
          </button>
        </form>
        <p className="mt-2 text-[11px] text-faint">The mentor coaches you on method. It won't give you answers.</p>
      </div>
    </div>
  )
}

/** Renders `code` spans only. */
export function Md({ s }: { s: string }) {
  return (
    <>
      {s.split(/(`[^`]+`)/).map((p, i) =>
        p.startsWith('`') ? (
          <code key={i} className="font-mono text-amber">
            {p.slice(1, -1)}
          </code>
        ) : (
          p
        ),
      )}
    </>
  )
}

export async function askMentor(body: { caseId: string; mode: 'hint' | 'debrief'; question?: string; found?: string[]; summary?: string }) {
  const r = await fetch('/api/mentor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(String(r.status))
  return ((await r.json()) as { answer: string }).answer
}
