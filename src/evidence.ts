// Evidence board items and the timestamp candidates a trainee can pick from.
import { fmtTime, td } from './fs/bytes'
import { readDocx, readExif, unzipList } from './fs/formats'
import type { Disk } from './fs/reader'
import type { Target } from './term/commands'

export type Candidate = { label: string; t: number }
export type Tag = { sha: string; name: string; source: string; candidates: Candidate[]; t: number | null }

const exifTime = (s: string) => Math.floor(Date.parse(s.replace(/^(\d+):(\d+):(\d+) /, '$1-$2-$3T') + 'Z') / 1000)

export function candidates(disk: Disk, t: Target): Candidate[] {
  const out: Candidate[] = []
  if (t.ino) {
    const n = disk.inode(t.ino)
    out.push(
      { label: '$SI Created (B)', t: n.btime },
      { label: '$SI Modified (M)', t: n.mtime },
      { label: '$SI Accessed (A)', t: n.atime },
      { label: '$SI Changed (C)', t: n.ctime },
      { label: '$FN Created (B)', t: n.fnBtime },
    )
  }
  const ex = readExif(t.bytes)
  if (ex) {
    const get = (k: string) => ex.find(([n]) => n === k)?.[1]
    const dto = get('DateTimeOriginal')
    if (dto) out.push({ label: `EXIF DateTimeOriginal (camera local${get('OffsetTimeOriginal') ? ' ' + get('OffsetTimeOriginal') : ''})`, t: exifTime(dto) })
    const gps = get('GPSDateTime (UTC)')
    if (gps) out.push({ label: 'EXIF GPSDateTime (UTC)', t: exifTime(gps) })
  }
  const doc = readDocx(t.bytes)
  if (doc) for (const [k, v] of doc.meta) if (/created|modified/.test(k)) out.push({ label: `docx ${k}`, t: Math.floor(Date.parse(v) / 1000) })
  if (!doc) for (const e of unzipList(t.bytes) ?? []) out.push({ label: `zip entry ${e.name} (local time)`, t: Math.floor(Date.parse(e.mtime.replace(' ', 'T') + 'Z') / 1000) })
  // Epoch markers in shell history (#1741906990): offer each one with the command that follows.
  const lines = td.decode(t.bytes.subarray(0, 8192)).split('\n')
  lines.forEach((l, i) => {
    const m = /^#(\d{9,10})$/.exec(l)
    if (m && lines[i + 1]) out.push({ label: `history: ${lines[i + 1].slice(0, 42)}`, t: Number(m[1]) })
  })
  return out.filter((c) => Number.isFinite(c.t) && c.t > 0)
}

export const describe = (c: Candidate) => `${fmtTime(c.t)} · ${c.label}`
