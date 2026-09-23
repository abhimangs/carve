// Signature-based file carving (foremost/photorec style): scan for headers,
// read forward to the format's footer. Assumes contiguous blocks.
import { indexOf, latin1, te, u16 } from './bytes'
import { BS, type Disk } from './reader'

export type Carved = { offset: number; type: 'jpg' | 'pdf' | 'zip' | 'docx'; bytes: Uint8Array }

const MAX = 64 * 1024

/** Given bytes starting at a header, return the file's extent or null. */
function extent(b: Uint8Array, p: number): Carved | null {
  const win = b.subarray(p, p + MAX)
  if (win[0] === 0xff && win[1] === 0xd8 && win[2] === 0xff) {
    const e = indexOf(win, [0xff, 0xd9], 2)
    return e < 0 ? null : { offset: p, type: 'jpg', bytes: win.slice(0, e + 2) }
  }
  if (latin1.decode(win.subarray(0, 5)) === '%PDF-') {
    const e = indexOf(win, te.encode('%%EOF'))
    if (e < 0) return null
    const end = e + 5 + (win[e + 5] === 0x0a ? 1 : 0)
    return { offset: p, type: 'pdf', bytes: win.slice(0, end) }
  }
  if (win[0] === 0x50 && win[1] === 0x4b && win[2] === 3 && win[3] === 4) {
    const e = indexOf(win, [0x50, 0x4b, 5, 6])
    if (e < 0) return null
    const bytes = win.slice(0, e + 22 + u16(win, e + 20))
    return { offset: p, type: indexOf(bytes, te.encode('word/document.xml')) >= 0 ? 'docx' : 'zip', bytes }
  }
  return null
}

/** Carve unallocated space. Headers are checked at block boundaries, like sector-aligned carvers. */
export function carveUnallocated(disk: Disk): Carved[] {
  const out: Carved[] = []
  const free = new Set(disk.unallocated())
  for (const blk of [...free].sort((a, b) => a - b)) {
    const c = extent(disk.bytes, blk * BS)
    if (c && !out.some((o) => c.offset < o.offset + o.bytes.length)) out.push(c)
  }
  return out
}

/** Find files hidden inside another file (e.g. a ZIP appended after a JPEG's EOI marker). */
export function carveEmbedded(b: Uint8Array): Carved[] {
  const out: Carved[] = []
  // Skip the host file's own structure (a docx's inner zip entries are not "hidden").
  for (let p = Math.max(1, extent(b, 0)?.bytes.length ?? 1); p < b.length - 4; p++) {
    const isHdr =
      (b[p] === 0x50 && b[p + 1] === 0x4b && b[p + 2] === 3 && b[p + 3] === 4) ||
      (b[p] === 0x25 && b[p + 1] === 0x50 && b[p + 2] === 0x44 && b[p + 3] === 0x46) ||
      (b[p] === 0xff && b[p + 1] === 0xd8 && b[p + 2] === 0xff)
    if (!isHdr) continue
    const c = extent(b, p)
    if (c) {
      out.push(c)
      p += c.bytes.length - 1
    }
  }
  return out
}
