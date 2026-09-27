// bun test: how loadCase turns case scripts into an answer key, and that the key is the shipped image.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CASES, loadCase, type Case } from './index'
import { CASE_META } from './meta'
import { buildImage } from '../fs/image'
import { NBLOCKS, BS } from '../fs/reader'

/** A two-file image with no case-specific data, so each locator can be broken in isolation. */
const mini = (find: Case['evidence'][number]['find']): Case => ({
  ...CASE_META[0],
  id: 'mini',
  ops: [
    { op: 'mkdir', path: '/home', t: '2025-01-01T00:00:00Z' },
    { op: 'write', path: '/home/a.txt', t: '2025-01-01T00:00:01Z', data: 'hello\n' },
  ],
  evidence: [
    { id: 'x', label: 'x', find, event: 'e', t: '2025-01-01T00:00:01Z', timeSource: 'the $FN birth time (B)', why: 'w' },
  ],
  decoys: [],
  hints: [],
})

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('locators', () => {
  test('a {path} locator that does not exist throws instead of becoming the SHA-256 of nothing', async () => {
    // It used to resolve to the empty-file digest, which then passed the shas-uniqueness test as a real-looking,
    // permanently unscoreable answer key entry.
    expect(EMPTY_SHA).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    await expect(loadCase(mini({ path: '/home/typo.txt' }))).rejects.toThrow(/no inode was ever written at \/home\/typo\.txt/)
  })

  test('a {carve} locator for a file that is still allocated throws', async () => {
    expect(loadCase(mini({ carve: '/home/a.txt' }))).rejects.toThrow('answer key: /home/a.txt is not carvable')
  })

  test('an {embedded} locator for a file with nothing hidden throws', async () => {
    expect(loadCase(mini({ embedded: '/home/a.txt' }))).rejects.toThrow('answer key: nothing embedded in /home/a.txt')
  })

  test('a locator that resolves yields the SHA-256 of the real bytes', async () => {
    const { key, disk } = await loadCase(mini({ path: '/home/a.txt' }))
    expect(key.evidence[0].sha).not.toBe(EMPTY_SHA)
    expect(disk.read(disk.resolve('/home/a.txt'))).toEqual(new TextEncoder().encode('hello\n'))
  })
})

describe('shipped images', () => {
  for (const c of CASES) {
    test(`${c.id}: public/cases/${c.id}.img is byte-identical to a fresh buildImage`, () => {
      const fresh = buildImage(c.label, c.ops).bytes
      const onDisk = new Uint8Array(readFileSync(join(import.meta.dir, '..', '..', 'public', 'cases', `${c.id}.img`)))
      expect(onDisk.length).toBe(NBLOCKS * BS)
      expect(onDisk.length).toBe(fresh.length)
      let firstBad = -1
      for (let i = 0; i < fresh.length; i++)
        if (onDisk[i] !== fresh[i]) {
          firstBad = i
          break
        }
      // A non-negative index here means `bun run gen:images` was not re-run after the ops changed.
      expect(firstBad, `${c.id}.img first differs at byte ${firstBad} (block ${Math.floor(firstBad / BS)})`).toBe(-1)
    })
  }
})

describe('determinism', () => {
  test('loadCase twice on the same case gives the same shas', async () => {
    for (const c of CASES) {
      const a = await loadCase(c)
      const b = await loadCase(c)
      expect(a.key).toEqual(b.key)
      expect(a.disk.bytes).toEqual(b.disk.bytes)
    }
  })

  test('every case is in CASE_META under the same id, and vice versa', () => {
    expect(CASES.map((c) => c.id)).toEqual(CASE_META.map((m) => m.id))
  })
})
