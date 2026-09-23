// CarveFS: a small ext-like filesystem. Everything the trainee sees is parsed
// from raw image bytes here; the terminal never touches case data directly.
import { latin1, td, u16, u32 } from './bytes'

export const BS = 512
export const NBLOCKS = 512 // 256 KiB image
export const NINODES = 64
export const INODE_SIZE = 128
export const BITMAP_BLK = 1
export const ITABLE_BLK = 2
export const DATA_BLK = ITABLE_BLK + (NINODES * INODE_SIZE) / BS // 18
export const ROOT = 1
export const MAX_PTRS = 22
export const MAGIC = 'CARVEFS1'

// Inode layout (128 B, little-endian):
//  0 mode u8 (0 free, 1 file, 2 dir)   1 flags u8 (1 alloc, 2 deleted, 4 hidden)
//  2 parent u16   4 size u32   8 mtime  12 atime  16 ctime  20 btime   ($SI-style, u32 unix)
// 24 fn_btime  28 fn_mtime  ($FN-style shadow copy; timestomping tools don't touch it)
// 32 nblocks u16  34 nameLen u8  36..83 name   84..127 block pointers u16 x22
export const F_ALLOC = 1, F_DEL = 2, F_HIDDEN = 4

export type Inode = {
  ino: number
  mode: 'free' | 'file' | 'dir'
  allocated: boolean
  deleted: boolean
  hidden: boolean
  parent: number
  size: number
  mtime: number
  atime: number
  ctime: number
  btime: number
  fnBtime: number
  fnMtime: number
  blocks: number[]
  name: string
}

export type DirEntry = { name: string; ino: number }

export class Disk {
  readonly bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    if (latin1.decode(bytes.subarray(0, 8)) !== MAGIC) throw new Error('not a CarveFS image')
    this.bytes = bytes
  }

  get label() {
    return latin1.decode(this.bytes.subarray(40, 72)).replace(/\0+$/, '')
  }

  inode(ino: number): Inode {
    const o = ITABLE_BLK * BS + ino * INODE_SIZE
    const b = this.bytes
    const flags = b[o + 1]
    const nb = u16(b, o + 32)
    return {
      ino,
      mode: (['free', 'file', 'dir'] as const)[b[o]] ?? 'free',
      allocated: !!(flags & F_ALLOC),
      deleted: !!(flags & F_DEL),
      hidden: !!(flags & F_HIDDEN),
      parent: u16(b, o + 2),
      size: u32(b, o + 4),
      mtime: u32(b, o + 8),
      atime: u32(b, o + 12),
      ctime: u32(b, o + 16),
      btime: u32(b, o + 20),
      fnBtime: u32(b, o + 24),
      fnMtime: u32(b, o + 28),
      blocks: Array.from({ length: Math.min(nb, MAX_PTRS) }, (_, i) => u16(b, o + 84 + i * 2)),
      name: td.decode(b.subarray(o + 36, o + 36 + Math.min(b[o + 34], 48))),
    }
  }

  /** Every inode slot that has ever been used (allocated or deleted-but-intact). */
  inodes() {
    return Array.from({ length: NINODES - 1 }, (_, i) => this.inode(i + 1)).filter((n) => n.mode !== 'free')
  }

  blockAllocated(blk: number) {
    return !!(this.bytes[BITMAP_BLK * BS + (blk >> 3)] & (1 << (blk & 7)))
  }

  unallocated() {
    const out: number[] = []
    for (let b = DATA_BLK; b < NBLOCKS; b++) if (!this.blockAllocated(b)) out.push(b)
    return out
  }

  /** Allocated inode that currently owns a block, if any. */
  blockOwner(blk: number) {
    return this.inodes().find((n) => n.allocated && n.blocks.includes(blk))?.ino ?? 0
  }

  block(blk: number) {
    return this.bytes.subarray(blk * BS, (blk + 1) * BS)
  }

  /** Raw content via the inode's block pointers (what icat does). Works for deleted inodes too. */
  read(ino: number) {
    const n = this.inode(ino)
    const out = new Uint8Array(n.size)
    n.blocks.forEach((blk, i) => {
      const chunk = this.block(blk).subarray(0, Math.min(BS, n.size - i * BS))
      out.set(chunk, i * BS)
    })
    return out
  }

  /** Blocks of a deleted inode that have since been reallocated to another file. */
  overwritten(ino: number) {
    const n = this.inode(ino)
    return n.allocated ? [] : n.blocks.filter((b) => this.blockAllocated(b)).map((b) => ({ block: b, owner: this.blockOwner(b) }))
  }

  readDir(ino: number): DirEntry[] {
    const d = this.read(ino)
    const out: DirEntry[] = []
    for (let p = 0; p + 3 <= d.length; ) {
      const e = u16(d, p), len = d[p + 2]
      if (e === 0 && len === 0) break
      if (e) out.push({ ino: e, name: td.decode(d.subarray(p + 3, p + 3 + len)) })
      p += 3 + len
    }
    return out
  }

  /** Resolve an absolute path through live directory entries only. */
  resolve(path: string) {
    let ino = ROOT
    for (const part of path.split('/').filter(Boolean)) {
      const e = this.readDir(ino).find((x) => x.name === part)
      if (!e) return 0
      ino = e.ino
    }
    return ino
  }

  /** Path reconstructed from the parent pointer + stored name (works for deleted entries, like $FN). */
  path(ino: number): string {
    if (ino === ROOT) return '/'
    const parts: string[] = []
    for (let n = this.inode(ino), guard = 0; n.ino !== ROOT && guard < 32; n = this.inode(n.parent), guard++) {
      if (!n.name) return '$OrphanFiles/' + parts.reverse().join('/')
      parts.push(n.name)
    }
    return '/' + parts.reverse().join('/')
  }
}
