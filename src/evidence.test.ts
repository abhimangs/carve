// bun test: the timestamp candidates the evidence board offers.
import { describe, expect, test } from 'bun:test'
import { CASES, loadCase, type Case, type Evidence, type Loaded } from './cases'
import { candidates, describe as label, type Candidate } from './evidence'
import { fmtTime, te, unix } from './fs/bytes'
import { docx, zip } from './fs/formats'
import { buildImage } from './fs/image'
import type { Disk } from './fs/reader'
import type { Target } from './term/commands'

const caseById = (id: string): Loaded => {
  const c = CASES.find((x) => x.id === id)
  if (!c) throw new Error(`evidence: CASES has no case "${id}"; it has ${CASES.map((x) => x.id).join(', ')}`)
  return LOADED[c.id]
}

const LOADED: Record<string, Loaded> = {}
for (const c of CASES) LOADED[c.id] = await loadCase(c)

/** The target for a case file, following the locator the answer key uses (deleted inodes included). */
function targetFor(id: string, c: Case, e: Evidence): Target {
  const l = caseById(id)
  const built = buildImage(c.label, c.ops)
  if ('path' in e.find) {
    const ino = built.inoOf[e.find.path]
    if (ino === undefined) throw new Error(`evidence: ${id}/${e.id}: ${e.find.path} has no inode`)
    return { path: l.disk.path(ino), bytes: l.disk.read(ino), ino, source: `inode ${ino}` }
  }
  throw new Error(`evidence: ${id}/${e.id}: only path locators are handled here`)
}

const candsFor = (id: string, e: Evidence) => {
  const c = caseById(id).c
  return candidates(caseById(id).disk, targetFor(id, c, e))
}

/** A bare target over arbitrary bytes: used for the filtering rules, which need no image. */
const over = (disk: Disk, bytes: Uint8Array | string, ino?: number): Target => ({
  path: '/synthetic',
  bytes: typeof bytes === 'string' ? te.encode(bytes) : bytes,
  ino,
  source: 'synthetic',
})

describe('inode fields', () => {
  test('a live file offers all five, with $SI and $FN birth times both named', () => {
    const l = caseById('insider')
    const c = candsFor('insider', l.c.evidence.find((e) => e.id === 'resign')!)
    const n = l.disk.inode(l.disk.resolve('/home/dreyes/Documents/resignation_letter.docx'))
    expect(c.map((x) => x.label)).toEqual([
      '$SI Created (B)',
      '$SI Modified (M)',
      '$SI Accessed (A)',
      '$SI Changed (C)',
      '$FN Created (B)',
      'docx created',
      'docx modified',
    ])
    expect(c[0]).toEqual({ label: '$SI Created (B)', t: n.btime })
    expect(c[4]).toEqual({ label: '$FN Created (B)', t: n.fnBtime })
  })

  test('a target with no inode offers no inode fields', () => {
    const c = candidates(caseById('insider').disk, over(caseById('insider').disk, 'plain text\n'))
    expect(c).toEqual([])
  })
})

describe('EXIF', () => {
  const photo = () => candsFor('fraud', caseById('fraud').c.evidence.find((e) => e.id === 'photo')!)

  test('GPSDateTime is UTC and DateTimeOriginal is camera local, offset included', () => {
    const c = photo()
    expect(c.find((x) => x.label === 'EXIF GPSDateTime (UTC)')).toEqual({ label: 'EXIF GPSDateTime (UTC)', t: unix('2025-04-02T18:48:10Z') })
    expect(c.find((x) => x.label.startsWith('EXIF DateTimeOriginal'))).toEqual({
      label: 'EXIF DateTimeOriginal (camera local +01:00)',
      t: unix('2025-04-02T19:48:10Z'), // read as a wall clock, so it lands an hour after the GPS fix
    })
    const dto = c.find((x) => x.label.startsWith('EXIF DateTimeOriginal'))!
    expect(dto.t - unix('2025-04-02T18:48:10Z')).toBe(3600)
  })

  test('the offset is left out of the label when the camera wrote none', () => {
    const c = candsFor('insider', caseById('insider').c.evidence.find((e) => e.id === 'shot')!)
    expect(c.map((x) => x.label)).toContain('EXIF DateTimeOriginal (camera local)')
    expect(c.map((x) => x.label)).not.toContain('EXIF DateTimeOriginal (camera local +00:00)')
  })

  test('a photo with no GPS block offers no UTC candidate', () => {
    const c = candsFor('fraud', caseById('fraud').c.evidence.find((e) => e.id === 'invoice')!)
    expect(c.map((x) => x.label)).not.toContain('EXIF GPSDateTime (UTC)')
  })
})

describe('docx and zip', () => {
  test('docx created and modified come from core.xml', () => {
    const c = candsFor('insider', caseById('insider').c.evidence.find((e) => e.id === 'resign')!)
    expect(c.find((x) => x.label === 'docx created')!.t).toBe(unix('2025-03-13T09:15:00Z'))
    expect(c.find((x) => x.label === 'docx modified')!.t).toBe(unix('2025-03-13T09:31:00Z'))
  })

  test('a zip entry is labelled local time, because the DOS stamp carries no zone', () => {
    const c = candsFor('insider', caseById('insider').c.evidence.find((e) => e.id === 'zip')!)
    expect(c.find((x) => x.label === 'zip entry clients_q3.csv (local time)')!.t).toBe(unix('2025-02-20T10:12:00Z'))
    expect(c.find((x) => x.label === 'zip entry pricing_2025.csv (local time)')!.t).toBe(unix('2025-01-08T15:40:00Z'))
  })

  test('a docx offers no zip entries, because it is one', () => {
    const c = candsFor('insider', caseById('insider').c.evidence.find((e) => e.id === 'resign')!)
    expect(c.map((x) => x.label).filter((l) => l.startsWith('zip entry'))).toEqual([])
  })
})

describe('shell history epochs', () => {
  const hist = (id: string, ev: string) => candsFor(id, caseById(id).c.evidence.find((e) => e.id === ev)!).filter((x) => x.label.startsWith('history:'))

  test('one candidate per epoch line, labelled with the command that follows it', () => {
    expect(hist('fraud', 'history')).toEqual([
      { label: 'history: python3 ~/bin/ts.py Documents/Invoices/inv', t: 1743618160 },
      { label: 'history: zip vault.zip bank_details.txt vendor_setu', t: 1743621150 },
      { label: 'history: cat IMG_0007.jpg vault.zip > Pictures/rece', t: 1743621161 },
      { label: 'history: shred -u bank_details.txt vendor_setup.txt', t: 1743621182 },
      { label: 'history: rm Downloads/audit_notice.pdf Pictures/IMG', t: 1743621605 },
    ])
  })

  test('the time is the raw epoch, not a parsed or rounded date', () => {
    for (const c of hist('insider', 'history')) expect(Number.isInteger(c.t)).toBe(true)
    expect(hist('insider', 'history').map((c) => c.t)).toContain(1741906990)
  })

  test('only the first 8 KiB is scanned for epoch lines', () => {
    const disk = caseById('insider').disk
    const deep = 'x'.repeat(9000) + '\n#1741906990\ncurl evil.example\n'
    expect(candidates(disk, over(disk, deep)).filter((c) => c.label.startsWith('history:'))).toEqual([])
    const shallow = '#1741906990\ncurl evil.example\n'
    expect(candidates(disk, over(disk, shallow))).toEqual([{ label: 'history: curl evil.example', t: 1741906990 }])
  })
})

describe('filtering and formatting', () => {
  const disk = caseById('insider').disk

  test('non-positive times are dropped, which is what a zeroed inode yields', () => {
    // Inode 1 (the root) has btime and atime of 0.
    expect(candidates(disk, over(disk, new Uint8Array(0), 1)).map((c) => c.label)).toEqual(['$SI Modified (M)', '$SI Changed (C)'])
  })

  test('non-finite times are dropped: unparseable docx dates never reach the board', () => {
    const bad = docx(['x'], { creator: 'a', lastModifiedBy: 'a', revision: 1, created: 'not a date', modified: '2025-13-45T99:99:99Z' }, '2025-03-13 09:31:00')
    expect(candidates(disk, over(disk, bad))).toEqual([])
  })

  test('a zero epoch line is dropped as non-positive', () => {
    expect(candidates(disk, over(disk, '#000000000\nrm -rf /\n'))).toEqual([])
  })

  test('every candidate time is finite and positive', () => {
    for (const id of CASES.map((c) => c.id))
      for (const e of caseById(id).c.evidence.filter((x) => 'path' in x.find))
        for (const c of candsFor(id, e)) expect(Number.isFinite(c.t) && c.t > 0).toBe(true)
  })

  test('describe renders "<time> · <label>"', () => {
    expect(label({ label: 'EXIF GPSDateTime (UTC)', t: 1743619690 })).toBe(`${fmtTime(1743619690)} · EXIF GPSDateTime (UTC)`)
    expect(label({ label: 'x', t: 1743619690 })).toBe('2025-04-02 18:48:10 UTC · x')
  })

  test('calling candidates twice on the same target gives deep-equal output', () => {
    for (const id of CASES.map((c) => c.id))
      for (const e of caseById(id).c.evidence.filter((x) => 'path' in x.find)) {
        const t = targetFor(id, caseById(id).c, e)
        expect(candidates(caseById(id).disk, t)).toEqual(candidates(caseById(id).disk, t))
      }
  })

  test('candidates are deduped: two zip entries with one name and one time give one row', () => {
    const dup = zip([
      { name: 'a.txt', data: 'x', mtime: '2025-03-13 09:31:00' },
      { name: 'a.txt', data: 'y', mtime: '2025-03-13 09:31:00' },
    ])
    const got = candidates(disk, over(disk, dup))
    expect(got).toHaveLength(1)
  })

  test('the inode fields come out in B, M, A, C, $FN order before any file-format candidates', () => {
    const c: Candidate[] = candsFor('insider', caseById('insider').c.evidence.find((e) => e.id === 'shot')!)
    expect(c.slice(0, 5).map((x) => x.label)).toEqual(['$SI Created (B)', '$SI Modified (M)', '$SI Accessed (A)', '$SI Changed (C)', '$FN Created (B)'])
    expect(c[5].label).toBe('EXIF DateTimeOriginal (camera local)')
  })
})
