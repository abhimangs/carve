// Sleuth Kit-flavoured shell. Every command reads raw image bytes through Disk.
import { fmtTime, sha256, td } from '../fs/bytes'
import { carveEmbedded, carveUnallocated } from '../fs/carve'
import { readDocx, readExif, sniff, unzipList, unzipRead } from '../fs/formats'
import { BS, DATA_BLK, type Disk, NBLOCKS, ROOT } from '../fs/reader'

export const C = {
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

export type Target = { path: string; bytes: Uint8Array; ino?: number; source: string }

export type Ctx = {
  disk: Disk
  cwd: string
  recovered: Map<string, { bytes: Uint8Array; source: string; ino?: number }>
  onFlsDeleted: () => void
  onTag: (t: Target, sha: string) => string
  onOpen: (t: Target) => void
  onRecovered: () => void
}

export const RECOVERED = '/recovered'

export function absPath(cwd: string, p: string) {
  const parts = (p.startsWith('/') ? p : `${cwd}/${p}`).split('/')
  const out: string[] = []
  for (const s of parts) {
    if (!s || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  return '/' + out.join('/')
}

/** Resolve a file argument: a path on the live FS, a /recovered artifact, or an inode number. */
export function target(ctx: Ctx, arg: string | undefined): Target | string {
  if (!arg) return 'missing file operand'
  const p = absPath(ctx.cwd, arg)
  if (p.startsWith(RECOVERED + '/')) {
    const r = ctx.recovered.get(p.slice(RECOVERED.length + 1))
    return r ? { path: p, bytes: r.bytes, source: r.source, ino: r.ino } : `${arg}: No such file`
  }
  const ino = ctx.disk.resolve(p)
  if (!ino) return `${arg}: No such file or directory${/^\d+$/.test(arg) ? ' (for inode numbers use icat/istat)' : ''}`
  if (ctx.disk.inode(ino).mode === 'dir') return `${arg}: Is a directory`
  return { path: p, bytes: ctx.disk.read(ino), ino, source: `inode ${ino}` }
}

const isHidden = (name: string, hidden: boolean) => hidden || name.startsWith('.')

function hexdump(b: Uint8Array, base = 0, limit = 512) {
  const lines: string[] = []
  for (let o = 0; o < Math.min(b.length, limit); o += 16) {
    const row = b.subarray(o, o + 16)
    const hex = [...row].map((x) => x.toString(16).padStart(2, '0')).join(' ').padEnd(47)
    const asc = [...row].map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('')
    lines.push(`${C.dim((base + o).toString(16).padStart(8, '0'))}  ${hex}  ${C.cyan('|' + asc + '|')}`)
  }
  if (b.length > limit) lines.push(C.dim(`... ${b.length - limit} more bytes (use -n <bytes> or -s <offset>)`))
  return lines.join('\n')
}

export function strings(b: Uint8Array, min = 4) {
  const out: string[] = []
  let cur = ''
  for (const x of b) {
    if (x >= 32 && x < 127) cur += String.fromCharCode(x)
    else {
      if (cur.length >= min) out.push(cur)
      cur = ''
    }
  }
  if (cur.length >= min) out.push(cur)
  return out
}

function flag(args: string[], f: string) {
  const i = args.indexOf(f)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}

export const HELP: [string, string][] = [
  ['ls [-a] [-l] [dir]', 'list live directory entries (-a shows hidden)'],
  ['cd <dir> / pwd', 'navigate'],
  ['cat <file>', 'print a text file'],
  ['file <file>', 'identify type by magic bytes'],
  ['fls [-r] [-d] [dir]', 'list entries incl. DELETED ones (*)'],
  ['istat <inode>', 'inode metadata: MACB times, $FN times, blocks'],
  ['icat <inode> [name]', 'recover an inode\'s data to /recovered'],
  ['blkls', 'summarise unallocated blocks'],
  ['carve', 'carve files from unallocated space by signature'],
  ['carve <file>', 'find files hidden inside a file'],
  ['hexdump [-s off] [-n len] <file>', 'hex view (or: hexdump -b <block>)'],
  ['strings [-n min] <file>', 'printable strings'],
  ['grep <text> <file>', 'lines containing text'],
  ['exif <file>', 'EXIF (JPEG) or core.xml (docx) metadata'],
  ['unzip -l <zip> | -p <zip> <entry>', 'list / print archive entries'],
  ['sha256sum <file>', 'hash a file'],
  ['date -d @<epoch>', 'convert a Unix epoch to UTC'],
  ['tag <file>', 'add to the evidence board'],
  ['open <file>', 'show in the viewer panel'],
  ['clear', 'clear the screen'],
]

export async function run(ctx: Ctx, line: string): Promise<string> {
  const args = line.match(/"[^"]*"|'[^']*'|\S+/g)?.map((a) => a.replace(/^["']|["']$/g, '')) ?? []
  const cmd = args.shift()
  if (!cmd) return ''
  const { disk } = ctx
  const need = (a?: string) => {
    const t = target(ctx, a)
    if (typeof t === 'string') throw new Error(t)
    return t
  }
  const inoArg = (a?: string) => {
    const n = Number(a)
    if (!a || !Number.isInteger(n) || n < 1 || n > 63) throw new Error(`${cmd}: expected an inode number (see fls)`)
    const node = disk.inode(n)
    if (node.mode === 'free') throw new Error(`${cmd}: inode ${n} is unused`)
    return node
  }

  try {
    switch (cmd) {
      case 'help':
        return [C.bold('Commands'), ...HELP.map(([c, d]) => `  ${C.amber(c.padEnd(34))} ${d}`), '', C.dim('Tab completes, ↑/↓ history. Recovered files live in /recovered.')].join('\n')
      case 'clear':
        return '\x1b[2J\x1b[H'
      case 'pwd':
        return ctx.cwd
      case 'whoami':
        return 'examiner'
      case 'cd': {
        const p = absPath(ctx.cwd, args[0] ?? '/')
        if (p === RECOVERED) return ((ctx.cwd = p), '')
        const ino = disk.resolve(p)
        if (!ino || disk.inode(ino).mode !== 'dir') return `cd: ${args[0]}: No such directory`
        ctx.cwd = p
        return ''
      }
      case 'ls': {
        const all = args.includes('-a') || args.includes('-la') || args.includes('-al')
        const long = args.includes('-l') || args.includes('-la') || args.includes('-al')
        const p = absPath(ctx.cwd, args.find((a) => !a.startsWith('-')) ?? '.')
        if (p === RECOVERED) {
          if (!ctx.recovered.size) return C.dim('(empty: use icat or carve to recover files here)')
          return [...ctx.recovered].map(([n, r]) => (long ? `${String(r.bytes.length).padStart(7)}  ${C.green(n)}  ${C.dim('← ' + r.source)}` : C.green(n))).join('\n')
        }
        const ino = disk.resolve(p)
        if (!ino) return `ls: ${p}: No such file or directory`
        if (disk.inode(ino).mode !== 'dir') return p
        const ents = disk.readDir(ino).map((e) => ({ ...e, n: disk.inode(e.ino) }))
        if (p === '/') ents.push({ name: 'recovered', ino: 0, n: { ...disk.inode(ROOT), mode: 'dir' as const, hidden: false } })
        const shown = ents.filter((e) => all || !isHidden(e.name, e.n.hidden))
        const nm = (e: (typeof ents)[number]) => (e.n.mode === 'dir' ? C.blue(e.name + '/') : e.name.startsWith('.') || e.n.hidden ? C.dim(e.name) : e.name)
        if (!long) return shown.map(nm).join('  ')
        return shown.map((e) => `${e.n.mode === 'dir' ? 'd' : '-'}rw-r--r--  ${String(e.ino || '-').padStart(3)}  ${String(e.n.size).padStart(6)}  ${fmtTime(e.n.mtime).slice(0, 16)}  ${nm(e)}`).join('\n')
      }
      case 'cat': {
        const t = need(args[0])
        const kind = sniff(t.bytes)
        if (!/ASCII|script|empty/.test(kind)) return C.amber(`cat: ${args[0]} is binary (${kind}). Try strings, hexdump, exif or unzip -l.`)
        return td.decode(t.bytes).replace(/\n$/, '')
      }
      case 'file': {
        const t = need(args[0])
        return `${args[0]}: ${sniff(t.bytes)}`
      }
      case 'fls': {
        const rec = args.includes('-r'), delOnly = args.includes('-d')
        const root = absPath(ctx.cwd, args.find((a) => !a.startsWith('-')) ?? '.')
        const rootIno = disk.resolve(root)
        if (!rootIno) return `fls: ${root}: not found`
        const out: string[] = []
        const walk = (dir: number, prefix: string) => {
          const live = disk.readDir(dir).map((e) => ({ name: e.name, n: disk.inode(e.ino), del: false }))
          const dead = disk.inodes().filter((n) => n.deleted && n.parent === dir).map((n) => ({ name: n.name, n, del: true }))
          for (const e of [...live, ...dead]) {
            const type = e.n.mode === 'dir' ? 'd/d' : 'r/r'
            const realloc = e.del && disk.overwritten(e.n.ino).length ? C.red('(realloc)') : ''
            const path = prefix + e.name
            if (!delOnly || e.del) out.push(`${type} ${e.del ? C.red('*') : ' '} ${String(e.n.ino).padStart(2)}${realloc}:\t${e.del ? C.red(path) : e.n.mode === 'dir' ? C.blue(path) : path}`)
            if (rec && e.n.mode === 'dir' && !e.del) walk(e.n.ino, path + '/')
          }
        }
        walk(rootIno, root === '/' ? '/' : root + '/')
        if (out.some((l) => l.includes('*'))) ctx.onFlsDeleted()
        return out.join('\n') || C.dim('(no entries)')
      }
      case 'istat': {
        const n = inoArg(args[0])
        const ow = disk.overwritten(n.ino)
        const stomped = n.btime < n.fnBtime || n.mtime < n.fnBtime
        const lines = [
          `${C.bold('inode:')} ${n.ino}    ${n.allocated ? C.green('Allocated') : C.red('Not Allocated (deleted)')}${n.hidden ? C.dim('  [hidden flag]') : ''}`,
          `name ($FN): ${n.name}    parent inode: ${n.parent}    path: ${disk.path(n.ino)}`,
          `type: ${n.mode}    size: ${n.size}`,
          '',
          C.bold('$STANDARD_INFORMATION times (user-modifiable):'),
          `  Created  (B): ${fmtTime(n.btime)}`,
          `  Modified (M): ${fmtTime(n.mtime)}`,
          `  Accessed (A): ${fmtTime(n.atime)}`,
          `  Changed  (C): ${fmtTime(n.ctime)}${n.deleted ? C.dim('   ← set when the file was deleted') : ''}`,
          C.bold('$FILE_NAME times (set by the filesystem):'),
          `  Created  (B): ${fmtTime(n.fnBtime)}`,
          `  Modified (M): ${fmtTime(n.fnMtime)}`,
        ]
        if (stomped) lines.push('', C.red('⚠ TIMESTOMP INDICATOR: $SI times are earlier than $FN creation. $SI was probably forged.'))
        lines.push('', `${C.bold('Direct blocks:')} ${n.blocks.join(' ') || '(none)'}`)
        for (const o of ow) lines.push(C.red(`⚠ block ${o.block} now belongs to inode ${o.owner}: content there has been OVERWRITTEN`))
        return lines.join('\n')
      }
      case 'icat': {
        const n = inoArg(args[0])
        if (n.mode === 'dir') return C.amber(`icat: inode ${n.ino} is a folder, not a file. Run fls -r -d / and use a number from the file list.`)
        const name = args[1] ?? `${n.ino}_${n.name || 'orphan'}`
        const bytes = disk.read(n.ino)
        ctx.recovered.set(name, { bytes, source: `icat inode ${n.ino} (${disk.path(n.ino)})`, ino: n.ino })
        ctx.onRecovered()
        const ow = disk.overwritten(n.ino)
        return [
          C.green(`Recovered ${bytes.length} bytes from inode ${n.ino} → /recovered/${name}`),
          `sha256 ${await sha256(bytes)}`,
          ...(ow.length ? [C.amber(`⚠ ${ow.length} of ${n.blocks.length} blocks were reallocated: this is a partial recovery.`)] : []),
          C.dim(`Next: file / cat / strings /recovered/${name}, then tag it.`),
        ].join('\n')
      }
      case 'blkls': {
        const free = disk.unallocated()
        const used = free.filter((b) => disk.block(b).some((x) => x !== 0))
        return [
          `Image: ${NBLOCKS} blocks × ${BS} B    data area starts at block ${DATA_BLK}`,
          `Unallocated: ${free.length} blocks, ${C.amber(String(used.length))} of them still hold non-zero data`,
          C.dim(`Blocks with residual data: ${used.join(' ')}`),
          C.dim('Inspect one with: hexdump -b <block>'),
        ].join('\n')
      }
      case 'carve': {
        if (args[0]) {
          const t = need(args[0])
          const hits = carveEmbedded(t.bytes)
          if (!hits.length) return C.dim('No embedded file signatures found.')
          const base = t.path.split('/').pop()
          return hits.map((h, i) => {
            const name = `${base}.embedded_${i}.${h.type}`
            ctx.recovered.set(name, { bytes: h.bytes, source: `embedded in ${t.path} @ offset ${h.offset}` })
            ctx.onRecovered()
            return C.green(`Found ${h.type.toUpperCase()} at offset ${h.offset} (0x${h.offset.toString(16)}), ${h.bytes.length} bytes → /recovered/${name}`)
          }).join('\n')
        }
        const hits = carveUnallocated(disk)
        if (!hits.length) return C.dim('No signatures in unallocated space.')
        return [
          C.dim(`Scanning ${disk.unallocated().length} unallocated blocks for JPEG / PDF / ZIP headers...`),
          ...hits.map((h) => {
            const name = `carved_${(h.offset / BS).toString().padStart(4, '0')}.${h.type}`
            ctx.recovered.set(name, { bytes: h.bytes, source: `carved from block ${h.offset / BS}` })
            ctx.onRecovered()
            return C.green(`${h.type.toUpperCase().padEnd(4)} block ${String(h.offset / BS).padStart(3)}  ${String(h.bytes.length).padStart(6)} B → /recovered/${name}`)
          }),
          C.dim('Carved files have no filename or timestamps; only their content survives.'),
        ].join('\n')
      }
      case 'hexdump': {
        const blk = flag(args, '-b')
        const s = Number(flag(args, '-s') ?? 0)
        const n = Number(flag(args, '-n') ?? 512)
        if (blk !== undefined) {
          const b = Number(blk)
          if (!(b >= 0 && b < NBLOCKS)) return 'hexdump: bad block'
          return `${C.dim(`block ${b} (${disk.blockAllocated(b) ? 'allocated' : 'UNALLOCATED'})`)}\n${hexdump(disk.block(b), b * BS, BS)}`
        }
        const t = need(args[0])
        return hexdump(t.bytes.subarray(s), s, n)
      }
      case 'strings': {
        const min = Number(flag(args, '-n') ?? 4)
        return strings(need(args[0]).bytes, min).join('\n')
      }
      case 'grep': {
        const [pat, f] = args
        if (!pat || !f) return 'usage: grep <text> <file>'
        const hits = td.decode(need(f).bytes).split('\n').filter((l) => l.toLowerCase().includes(pat.toLowerCase()))
        return hits.map((l) => l.replaceAll(new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => C.red(m))).join('\n')
      }
      case 'exif': {
        const t = need(args[0])
        const ex = readExif(t.bytes)
        if (ex) return ex.map(([k, v]) => `${C.amber(k.padEnd(22))} ${v}`).join('\n')
        const d = readDocx(t.bytes)
        if (d) return [C.bold('docProps/core.xml'), ...d.meta.map(([k, v]) => `${C.amber(k.padEnd(22))} ${v}`), '', C.bold('Document text'), d.text].join('\n')
        return C.dim('No EXIF or Office metadata found.')
      }
      case 'unzip': {
        if (args[0] === '-p') {
          const out = unzipRead(need(args[1]).bytes, args[2] ?? '')
          return out ? td.decode(out).replace(/\n$/, '') : `unzip: entry ${args[2]} not found`
        }
        const t = need(args[0] === '-l' ? args[1] : args[0])
        const list = unzipList(t.bytes)
        if (!list) return 'unzip: not a zip archive (no end-of-central-directory record)'
        return [`  Length  Date       Time      Name`, `---------  ---------- --------  ----`, ...list.map((e) => `${String(e.size).padStart(9)}  ${e.mtime}  ${e.name}`), C.dim('Zip times are local wall-clock time with no timezone.')].join('\n')
      }
      case 'sha256sum': {
        const t = need(args[0])
        return `${await sha256(t.bytes)}  ${args[0]}`
      }
      case 'date': {
        const d = flag(args, '-d')
        if (d?.startsWith('@')) {
          const n = Number(d.slice(1))
          return Number.isFinite(n) ? new Date(n * 1000).toUTCString().replace('GMT', 'UTC') : 'date: invalid epoch'
        }
        return 'usage: date -d @<epoch>'
      }
      case 'tag': {
        const t = need(args[0])
        return ctx.onTag(t, await sha256(t.bytes))
      }
      case 'open': {
        ctx.onOpen(need(args[0]))
        return ''
      }
      default:
        return `${cmd}: command not found. Type ${C.amber('help')}`
    }
  } catch (e) {
    return C.red(`${cmd}: ${(e as Error).message}`)
  }
}

/** Tab completion over commands and live/recovered paths. */
export function complete(ctx: Ctx, line: string) {
  const words = line.split(' ')
  const last = words[words.length - 1]
  let cands: string[]
  if (words.length === 1) cands = HELP.flatMap(([c]) => c.split(' ')[0].split('/').map((x) => x.trim())).concat('help')
  else {
    const slash = last.lastIndexOf('/')
    const dirPart = slash >= 0 ? last.slice(0, slash + 1) : ''
    const dir = absPath(ctx.cwd, dirPart || '.')
    if (dir === RECOVERED) cands = [...ctx.recovered.keys()].map((n) => dirPart + n)
    else {
      const ino = ctx.disk.resolve(dir)
      cands = ino ? ctx.disk.readDir(ino).map((e) => dirPart + e.name + (ctx.disk.inode(e.ino).mode === 'dir' ? '/' : '')) : []
      if (dir === '/') cands.push(dirPart + 'recovered/')
    }
  }
  const m = [...new Set(cands)].filter((c) => c.startsWith(last))
  if (!m.length) return { line, options: [] }
  let pre = m[0]
  for (const x of m) while (!x.startsWith(pre)) pre = pre.slice(0, -1)
  words[words.length - 1] = m.length === 1 && !pre.endsWith('/') ? pre + ' ' : pre
  return { line: words.join(' '), options: m.length > 1 ? m : [] }
}
