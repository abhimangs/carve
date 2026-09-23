import { ArrowRight, Trophy } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { CASES, type Case, loadCase } from '../cases'
import { fmtTime } from '../fs/bytes'
import { Difficulty } from './Workspace'

export const best = (id: string) => {
  try {
    return Number(localStorage.getItem(`carve:best:${id}`)) || null
  } catch {
    return null
  }
}

const SKILLS: Record<string, string[]> = {
  insider: ['Listing deleted entries', 'Inode recovery', 'Shell-history epochs'],
  ransomware: ['Partial overwrites', 'Signature carving', 'Deletion (C) times'],
  fraud: ['Timestomp detection', 'EXIF GPS and timezones', 'Data hidden after EOI'],
}

type Preview = { shot: number; rows: { ino: number; path: string; when: string; realloc: boolean }[]; img: string; bytes: string }

/** Real output from case 1's disk image: deleted inodes and a recovered screenshot. Nothing here is mocked. */
function useRealPreview() {
  const [p, setP] = useState<Preview | null>(null)
  useEffect(() => {
    let url = ''
    loadCase(CASES[0]).then(({ disk }) => {
      const del = disk.inodes().filter((n) => n.deleted)
      const shot = del.find((n) => n.name.endsWith('.jpg'))!
      const data = disk.read(shot.ino)
      url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/jpeg' }))
      setP({
        shot: shot.ino,
        rows: del.map((n) => ({ ino: n.ino, path: disk.path(n.ino), when: fmtTime(n.ctime).slice(5, 16), realloc: disk.overwritten(n.ino).length > 0 })),
        img: url,
        bytes: [...data.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join(' '),
      })
    })
    return () => URL.revokeObjectURL(url)
  }, [])
  return p
}

export default function Home({ onStart, busy }: { onStart: (c: Case) => void; busy: string | null }) {
  const preview = useRealPreview()
  return (
    <div className="h-full overflow-auto">
      <nav className="mx-auto flex h-16 max-w-7xl items-center px-6">
        <span className="font-mono text-sm font-bold tracking-[0.25em] text-amber">CARVE</span>
        <a href="https://github.com/abhimangs/carve" className="ml-auto text-sm text-mute hover:text-ink">
          Source
        </a>
      </nav>

      <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-20 pt-12 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
        <div className="rise">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber">Digital forensics trainer</p>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            Recover what was deleted. <span className="text-mute">Prove what happened.</span>
          </h1>
          <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-mute">Real disk images built in your browser. Recover deleted files, expose forged timestamps, rebuild the timeline, get scored.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button onClick={() => onStart(CASES[0])} disabled={!!busy} className="inline-flex items-center gap-2 rounded-md bg-amber px-5 py-3 font-semibold text-bg transition hover:brightness-110">
              {busy === CASES[0].id ? 'Building image' : 'Start first case'} <ArrowRight weight="bold" />
            </button>
            <a href="#cases" className="rounded-md border border-line px-5 py-3 text-ink transition hover:border-mute">
              All cases
            </a>
          </div>
        </div>

        <figure className="rise overflow-hidden rounded-md border border-line bg-panel" style={{ ['--i' as string]: 2 }}>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-mute">
            <span>
              <span className="text-ok">examiner@carve</span>:/$ fls -r -d /
            </span>
            <span className="text-faint">NWA-WS-0142.img</span>
          </div>
          <div className="min-h-[164px] px-4 py-3 font-mono text-[12.5px] leading-6">
            {!preview && <div className="h-[140px] animate-pulse rounded bg-raised" />}
            {preview?.rows.map((r) => (
              <div key={r.ino} className="flex gap-3 truncate">
                <span className="text-bad">r/r *</span>
                <span className="w-6 text-right text-mute">{r.ino}</span>
                <span className="truncate text-bad/90">{r.path}</span>
                <span className="ml-auto shrink-0 text-faint">rm {r.when}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-4 border-t border-line bg-bg/60 p-4">
            {preview ? <img src={preview.img} alt="Screenshot recovered from a deleted inode in case 1" className="h-[105px] w-[180px] rounded border border-line object-cover" /> : <div className="h-[105px] w-[180px] animate-pulse rounded bg-raised" />}
            <div className="min-w-0 self-center font-mono text-xs leading-relaxed text-mute">
              <div className="text-ink">icat {preview?.shot} recovered a deleted screenshot</div>
              <div className="mt-2 break-all text-[11px]">
                <span className="bg-amber/20 text-amber">{preview?.bytes.slice(0, 8)}</span>
                {preview?.bytes.slice(8)}
              </div>
              <div className="mt-1 text-faint">JPEG magic bytes, read straight from unallocated blocks</div>
            </div>
          </div>
          <figcaption className="sr-only">Live output from the first case's disk image.</figcaption>
        </figure>
      </section>

      <section id="cases" className="mx-auto max-w-7xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Three incidents, rising difficulty</h2>
        <p className="mt-3 max-w-[60ch] text-mute">Each case replays a scripted incident onto a fresh 256 KiB image. Every case includes decoys.</p>
        <div className="mt-10 divide-y divide-line border-y border-line">
          {CASES.map((c, i) => {
            const b = best(c.id)
            return (
              <article key={c.id} className="rise grid items-center gap-6 py-8 md:grid-cols-[180px_1fr_220px]" style={{ ['--i' as string]: i }}>
                <div className="flex items-center gap-3 md:flex-col md:items-start">
                  <Difficulty d={c.difficulty} />
                  {b !== null && (
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-mute">
                      <Trophy /> best {b}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="text-xl font-semibold">{c.title}</h3>
                  <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed text-mute">{c.brief[0]}</p>
                  <p className="mt-3 font-mono text-xs text-faint">{SKILLS[c.id].join(', ')}</p>
                </div>
                <button onClick={() => onStart(c)} disabled={!!busy} className="inline-flex items-center justify-center gap-2 justify-self-start rounded-md border border-line px-4 py-2.5 text-sm font-medium transition hover:border-amber hover:text-amber md:justify-self-end">
                  {busy === c.id ? 'Building image' : 'Open case'} <ArrowRight />
                </button>
              </article>
            )
          })}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">How a case plays</h2>
          <dl className="mt-8 space-y-7">
            {[
              ['Investigate', 'fls, istat, icat, carve, strings, exif and hexdump against raw bytes. Clicking in the explorer runs the same command in the terminal, so you learn the tool.'],
              ['Tag and order', 'Tagged artifacts are identified by SHA-256. Drag them into order and decide which timestamp to trust.'],
              ['Debrief', 'See the true timeline, where each correct time comes from, and an AI mentor review of your investigation.'],
            ].map(([t, d]) => (
              <div key={t}>
                <dt className="font-semibold">{t}</dt>
                <dd className="mt-1.5 max-w-[60ch] leading-relaxed text-mute">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="grid grid-cols-2 gap-px self-start overflow-hidden rounded-md border border-line bg-line">
          {[
            ['40', 'Recovery', 'evidence found'],
            ['25', 'Ordering', 'event pairs in true order'],
            ['25', 'Timestamps', 'true UTC time within 60 s'],
            ['10', 'Precision', 'minus 3 per decoy'],
          ].map(([n, t, d]) => (
            <div key={t} className="bg-panel p-6">
              <div className="font-mono text-4xl font-bold text-ink">{n}</div>
              <div className="mt-2 font-medium">{t}</div>
              <div className="mt-0.5 text-sm text-mute">{d}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl items-center gap-2 border-t border-line px-6 py-8 text-sm text-faint">
        All cases are fictional. No real case data is used.
      </footer>
    </div>
  )
}
