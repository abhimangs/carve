// Replays a case's operation log into a CarveFS image. Deletes behave like
// real filesystems: the directory entry goes, the inode and data blocks stay.
import { te, toBytes, unix, w16, w32 } from './bytes'
import { BITMAP_BLK, BS, DATA_BLK, Disk, F_ALLOC, F_DEL, F_HIDDEN, INODE_SIZE, ITABLE_BLK, MAGIC, MAX_PTRS, NBLOCKS, NINODES, ROOT } from './reader'

export type Op =
  | { op: 'mkdir'; path: string; t: string }
  /** Create or rewrite a file. `reuse` allocates first-fit, landing on freed blocks (overwrites deleted data). */
  | { op: 'write'; path: string; t: string; data: Uint8Array | string; hidden?: boolean; reuse?: boolean; as?: string }
  | { op: 'access'; path: string; t: string }
  | { op: 'delete'; path: string; t: string }
  /** Delete and zero the inode record: data survives only in unallocated space (carving only). */
  | { op: 'wipe'; path: string; t: string }
  /** Anti-forensics: rewrite $SI times. The $FN shadow keeps the truth. */
  | { op: 'stomp'; path: string; t: string; set: { m?: string; a?: string; b?: string } }

const OFF = { mode: 0, flags: 1, parent: 2, size: 4, m: 8, a: 12, c: 16, b: 20, fnB: 24, fnM: 28, nb: 32, nameLen: 34, name: 36, ptr: 84 }

export function buildImage(label: string, ops: Op[]) {
  const img = new Uint8Array(NBLOCKS * BS)
  const disk = new Disk((img.set(te.encode(MAGIC)), img))
  const inoOf: Record<string, number> = { '/': ROOT }
  const startOf: Record<string, number> = {} // first data block of each file as last written (for carve answer keys)
  let nextIno = ROOT + 1
  let cursor = DATA_BLK

  w32(img, 8, BS); w32(img, 12, NBLOCKS); w32(img, 16, NINODES)
  w32(img, 20, BITMAP_BLK); w32(img, 24, ITABLE_BLK); w32(img, 28, DATA_BLK); w32(img, 32, ROOT)
  img.set(te.encode(label.slice(0, 31)), 40)

  const at = (ino: number, f: keyof typeof OFF) => ITABLE_BLK * BS + ino * INODE_SIZE + OFF[f]
  const setBit = (blk: number, on: boolean) => {
    const o = BITMAP_BLK * BS + (blk >> 3)
    img[o] = on ? img[o] | (1 << (blk & 7)) : img[o] & ~(1 << (blk & 7))
  }
  for (let b = 0; b < DATA_BLK; b++) setBit(b, true)

  const alloc = (n: number, reuse: boolean) => {
    const start = reuse ? DATA_BLK : cursor
    for (let k = 0; k < NBLOCKS - DATA_BLK; k++) {
      const s = DATA_BLK + ((start - DATA_BLK + k) % (NBLOCKS - DATA_BLK))
      if (s + n > NBLOCKS) continue
      let ok = true
      for (let i = 0; i < n && ok; i++) ok = !disk.blockAllocated(s + i)
      if (!ok) continue
      for (let i = 0; i < n; i++) setBit(s + i, true)
      cursor = s + n
      return Array.from({ length: n }, (_, i) => s + i)
    }
    throw new Error('CarveFS: disk full')
  }

  const setContent = (ino: number, data: Uint8Array, reuse = false) => {
    const need = Math.ceil(data.length / BS)
    if (need > MAX_PTRS) throw new Error(`CarveFS: file too large (${data.length} B)`)
    const cur = disk.inode(ino).allocated ? disk.inode(ino).blocks : []
    cur.slice(need).forEach((b) => setBit(b, false))
    const blocks = need <= cur.length ? cur.slice(0, need) : [...cur, ...alloc(need - cur.length, reuse)]
    // Only `data.length` bytes are written: the rest of the last block keeps old bytes (slack space).
    blocks.forEach((b, i) => img.set(data.subarray(i * BS, (i + 1) * BS), b * BS))
    w32(img, at(ino, 'size'), data.length)
    w16(img, at(ino, 'nb'), blocks.length)
    img.fill(0, at(ino, 'ptr'), at(ino, 'ptr') + MAX_PTRS * 2)
    blocks.forEach((b, i) => w16(img, at(ino, 'ptr') + i * 2, b))
  }

  const times = (ino: number, t: number, which: string) => {
    for (const k of which) w32(img, at(ino, k as 'm'), t)
  }

  const newInode = (mode: 1 | 2, name: string, parent: number, t: number, hidden: boolean) => {
    const ino = nextIno++
    if (ino >= NINODES) throw new Error('CarveFS: out of inodes')
    const n = te.encode(name).slice(0, 48)
    img[at(ino, 'mode')] = mode
    img[at(ino, 'flags')] = F_ALLOC | (hidden ? F_HIDDEN : 0)
    w16(img, at(ino, 'parent'), parent)
    img[at(ino, 'nameLen')] = n.length
    img.set(n, at(ino, 'name'))
    times(ino, t, 'macb')
    w32(img, at(ino, 'fnB'), t)
    w32(img, at(ino, 'fnM'), t)
    return ino
  }

  const writeDir = (dir: number, entries: { name: string; ino: number }[], t: number) => {
    const parts = entries.flatMap((e) => {
      const n = te.encode(e.name)
      return [e.ino & 0xff, e.ino >> 8, n.length, ...n]
    })
    setContent(dir, new Uint8Array([...parts, 0, 0, 0]))
    times(dir, t, 'mc')
  }

  const split = (path: string) => {
    const i = path.lastIndexOf('/')
    const parentPath = path.slice(0, i) || '/'
    const parent = disk.resolve(parentPath)
    if (!parent) throw new Error(`CarveFS: no parent dir for ${path}`)
    return { parent, name: path.slice(i + 1) }
  }

  const unlink = (path: string, t: number) => {
    const { parent, name } = split(path)
    const ino = disk.resolve(path)
    if (!ino) throw new Error(`CarveFS: cannot delete missing ${path}`)
    writeDir(parent, disk.readDir(parent).filter((e) => e.name !== name), t)
    disk.inode(ino).blocks.forEach((b) => setBit(b, false))
    return ino
  }

  img[at(ROOT, 'mode')] = 2
  img[at(ROOT, 'flags')] = F_ALLOC

  for (const op of ops) {
    const t = unix(op.t)
    if (op.op === 'mkdir') {
      const { parent, name } = split(op.path)
      const ino = newInode(2, name, parent, t, false)
      writeDir(ino, [], t)
      writeDir(parent, [...disk.readDir(parent), { name, ino }], t)
      inoOf[op.path] = ino
    } else if (op.op === 'write') {
      let ino = disk.resolve(op.path)
      if (!ino) {
        const { parent, name } = split(op.path)
        ino = newInode(1, name, parent, t, !!op.hidden)
        writeDir(parent, [...disk.readDir(parent), { name, ino }], t)
      }
      setContent(ino, toBytes(op.data), op.reuse)
      times(ino, t, 'mac')
      // `as` names this exact inode, e.g. an old file that is later deleted and recreated at the same path.
      for (const k of [op.path, op.as ?? op.path]) {
        inoOf[k] = ino
        startOf[k] = disk.inode(ino).blocks[0]
      }
    } else if (op.op === 'access') {
      times(disk.resolve(op.path), t, 'a')
    } else if (op.op === 'delete') {
      const ino = unlink(op.path, t)
      img[at(ino, 'flags')] = F_DEL
      times(ino, t, 'c')
    } else if (op.op === 'wipe') {
      const ino = unlink(op.path, t)
      img.fill(0, at(ino, 'mode'), at(ino, 'mode') + INODE_SIZE)
    } else if (op.op === 'stomp') {
      const ino = disk.resolve(op.path)
      for (const [k, v] of Object.entries(op.set)) times(ino, unix(v), k)
    }
  }
  return { bytes: img, inoOf, startOf }
}
