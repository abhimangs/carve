// bun test: every case's image must be self-consistent with its answer key.
import { expect, test } from 'bun:test'
import { CASES, loadCase, type Case, type Evidence, type Key } from './cases'
import { candidates } from './evidence'
import { td } from './fs/bytes'
import { carveEmbedded, carveUnallocated } from './fs/carve'
import { readExif, unzipList } from './fs/formats'
import { buildImage } from './fs/image'
import { BS, type Disk } from './fs/reader'
import { score, W } from './score'
import type { Target } from './term/commands'

/** Cases are looked up by id, never by position: inserting a case must not silently re-point a test. */
const caseById = (id: string): Case => {
  const c = CASES.find((x) => x.id === id)
  if (!c) throw new Error(`selfcheck: CASES has no case "${id}"; it has ${CASES.map((x) => x.id).join(', ')}`)
  return c
}

/** The Target a trainee ends up holding for an item, recovered through that item's own locator. */
function targetFor(disk: Disk, c: Case, e: Evidence): Target {
  const built = buildImage(c.label, c.ops)
  if ('path' in e.find) {
    const ino = built.inoOf[e.find.path]
    if (ino === undefined) throw new Error(`selfcheck: ${c.id}/${e.id}: ${e.find.path} has no inode`)
    return { path: disk.path(ino), bytes: disk.read(ino), ino, source: `inode ${ino}` }
  }
  const hit =
    'carve' in e.find
      ? carveUnallocated(disk).find((h) => h.offset === built.startOf[e.find.carve] * BS)
      : carveEmbedded(disk.read(built.inoOf[e.find.embedded]))[0]
  if (!hit) throw new Error(`selfcheck: ${c.id}/${e.id}: ${JSON.stringify(e.find)} recovered nothing`)
  return { path: `/recovered/carved.${hit.type}`, bytes: hit.bytes, source: 'carved' }
}

/**
 * The source label a perfect run submits per item. A time only scores when the field the label names is one
 * the case's timeSource copy endorses, so this pairing is part of the answer. Items missing from the table
 * have no candidate at the truth second, or a copy that names no field, so the correct answer there is a
 * hand-typed time: it names nothing, so it cannot be the wrong field.
 */
const PERFECT_SOURCE: Record<string, string> = {
  'insider/offer': '$SI Created (B)',
  'insider/resign': '$SI Created (B)',
  'insider/zip': '$SI Created (B)',
  'insider/history': 'history: curl -s -F "file=@/tmp/q3_clients.zip" htt',
  'insider/shot': '$SI Created (B)',
  'ransomware/dropper': '$SI Created (B)',
  'ransomware/exfil': 'zip entry manifest.txt (local time)',
  'ransomware/plain': '$SI Changed (C)',
  'ransomware/note': '$SI Created (B)',
  'fraud/invoice': '$FN Created (B)',
  'fraud/history': 'history: python3 ~/bin/ts.py Documents/Invoices/inv',
  'fraud/photo': 'EXIF GPSDateTime (UTC)',
}

/** Per case: an item plus a candidate that lands inside the tolerance window naming a field the copy does not. */
const WRONG_FIELD: Record<string, { id: string; label: string }> = {
  insider: { id: 'history', label: '$SI Created (B)' },
  ransomware: { id: 'note', label: '$SI Modified (M)' },
  fraud: { id: 'invoice', label: '$SI Changed (C)' },
}

/** Items whose truth second no candidate offers. Data gap, not test gap; each stays asserted as still missing. */
const CANDIDATE_OPTOUT: Record<string, string> = {
  'ransomware/auth': 'the truth is the "Accepted password" line inside the recovered log, not a metadata field: nearest candidate is 91s off',
  'fraud/audit': 'the audit notice is a carved PDF with no EXIF, no docx, no zip and no epoch lines: 0 candidates',
  'fraud/vault': 'the vault zip stores BST wall-clock time and candidates parses it as UTC, so both entry times land ~1h off',
}

function perfectTimeline(disk: Disk, c: Case, key: Key) {
  return [...key.evidence]
    .sort((a, b) => a.truth - b.truth)
    .map((e) => {
      const src = PERFECT_SOURCE[`${c.id}/${e.id}`]
      if (src) {
        const cand = candidates(disk, targetFor(disk, c, e)).find((x) => x.label === src)
        if (!cand) throw new Error(`selfcheck: ${c.id}/${e.id} offers no candidate labelled ${JSON.stringify(src)}`)
        if (Math.abs(cand.t - e.truth) > W.tolerance) throw new Error(`selfcheck: ${c.id}/${e.id}: ${src} is not at the truth second`)
      }
      return { sha: e.sha, t: e.truth, source: src }
    })
}

for (const c of CASES) {
  test(`${c.id}: image + answer key`, async () => {
    const { disk, key } = await loadCase(c)
    const shas = key.evidence.map((e) => e.sha)
    expect(new Set(shas).size).toBe(shas.length)
    for (const d of key.decoys) expect(shas).not.toContain(d.sha)

    // Deleted files are invisible to live directory walks but their inodes survive.
    const deleted = disk.inodes().filter((n) => n.deleted)
    expect(deleted.length).toBeGreaterThan(0)
    for (const n of deleted) expect(disk.resolve(disk.path(n.ino))).not.toBe(n.ino)

    const n = shas.length
    const timeline = perfectTimeline(disk, c, key)
    const perfect = { tagged: shas, timeline, hints: 0 }
    expect(score(key, perfect).total).toBe(100)
    expect(score(key, { tagged: [], timeline: [], hints: 0 }).total).toBe(0)

    // Order is gated on recovery: a perfect timeline with nothing tagged used to award a free 25.
    const untagged = score(key, { tagged: [], timeline, hints: 0 })
    expect(untagged.total).toBe(0)
    expect(untagged.parts[1].pts).toBe(0)

    // One adjacent swap loses exactly one of n(n-1)/2 pairs.
    const swapped = [...timeline]
    ;[swapped[0], swapped[1]] = [swapped[1], swapped[0]]
    const order = score(key, { ...perfect, timeline: swapped }).parts[1]
    expect(order.pts).toBeCloseTo((25 * (n * (n - 1) / 2 - 1)) / (n * (n - 1) / 2))

    // Spraying tag over a carver run is net negative: precision is a real ratio and the decoys add to it.
    const spray = score(key, { tagged: [...shas, ...key.decoys.map((d) => d.sha)], timeline: [], hints: 0 })
    const evidenceOnly = score(key, { tagged: shas, timeline: [], hints: 0 })
    expect(spray.total).toBeLessThan(evidenceOnly.total)
    expect(spray.parts[3].pts).toBeCloseTo((W.precision * n) / (n + key.decoys.length))
    expect(spray.decoyPenalty).toBe(W.decoy * key.decoys.length)

    // One decoy: the precision ratio drops to 10*found/flagged and W.decoy is also hit at the total.
    const decoy = score(key, { ...perfect, tagged: [...shas, key.decoys[0].sha] })
    expect(decoy.parts[3].pts).toBeCloseTo((W.precision * n) / (n + 1))
    expect(decoy.decoyPenalty).toBe(W.decoy)
    expect(decoy.total).toBe(95)

    // Right second, wrong named field: no time points. Same second, hand-typed (no source): full credit.
    const wrong = WRONG_FIELD[c.id]
    const e = key.evidence.find((x) => x.id === wrong.id)!
    const cand = candidates(disk, targetFor(disk, c, e)).find((x) => x.label === wrong.label)!
    expect(Math.abs(cand.t - e.truth)).toBeLessThanOrEqual(W.tolerance)
    const at = (patch: object) => timeline.map((x) => (x.sha === e.sha ? { ...x, ...patch } : x))
    const named = score(key, { ...perfect, timeline: at({ t: cand.t, source: cand.label }) })
    expect(named.per.find((p) => p.id === e.id)!.timeOk).toBe(false)
    expect(named.parts[2].pts).toBeCloseTo((W.time * (n - 1)) / n)
    const typed = score(key, { ...perfect, timeline: at({ t: cand.t, source: undefined }) })
    expect(typed.per.find((p) => p.id === e.id)!.timeOk).toBe(true)
    expect(typed.parts[2].pts).toBeCloseTo(W.time)
  })

  test(`${c.id}: every truth second is offered as a candidate`, async () => {
    const { disk, key } = await loadCase(c)
    for (const e of key.evidence) {
      const cands = candidates(disk, targetFor(disk, c, e))
      const reachable = cands.some((x) => Math.abs(x.t - e.truth) <= W.tolerance)
      const opt = CANDIDATE_OPTOUT[`${c.id}/${e.id}`]
      // An opt-out asserts the gap is still open, so closing it fails loudly instead of going unnoticed.
      if (opt) expect(reachable, `${c.id}/${e.id}: ${opt}`).toBe(false)
      else expect(reachable, `${c.id}/${e.id} has no candidate within ±${W.tolerance}s of ${e.t}`).toBe(true)
    }
  })
}

test('the tables above between them name every evidence item, with no stale keys', () => {
  const items = CASES.flatMap((c) => c.evidence.map((e) => `${c.id}/${e.id}`))
  const sourced = Object.keys(PERFECT_SOURCE)
  const opted = Object.keys(CANDIDATE_OPTOUT)
  expect([...sourced, ...opted].sort()).toEqual([...items].sort()) // disjoint and exhaustive
  expect(Object.keys(WRONG_FIELD).sort()).toEqual(CASES.map((c) => c.id).sort())
  for (const id of CASES.map((c) => c.id)) expect(WRONG_FIELD[id].id).toBeTruthy()
  for (const c of CASES)
    for (const e of c.evidence) expect(c.evidence.filter((x) => x.id === e.id)).toHaveLength(1) // ids unique per case
})

test('insider: deleted history recoverable, zip readable', async () => {
  const { disk } = await loadCase(caseById('insider'))
  const old = disk.inodes().find((n) => n.deleted && n.name === '.bash_history')!
  expect(td.decode(disk.read(old.ino))).toContain('dropshare.io')
  const z = disk.inodes().find((n) => n.name === 'q3_clients.zip')!
  expect(unzipList(disk.read(z.ino))!.map((e) => e.name)).toEqual(['clients_q3.csv', 'pricing_2025.csv'])
})

test('ransomware: auth.log partly overwritten, zip only carvable', async () => {
  const { disk } = await loadCase(caseById('ransomware'))
  const auth = disk.inodes().find((n) => n.name === 'auth.log')!
  expect(disk.overwritten(auth.ino).length).toBeGreaterThan(0)
  const text = td.decode(disk.read(auth.ino))
  expect(text).toContain('Accepted password')
  expect(text).not.toContain('02:10:14') // first failures destroyed by the overwrite
  expect(disk.inodes().some((n) => n.name === 'f.zip')).toBe(false)
  expect(carveUnallocated(disk).some((c) => c.type === 'zip' && unzipList(c.bytes)!.some((e) => e.name === 'manifest.txt'))).toBe(true)
})

test('fraud: timestomp visible, EXIF + embedded zip', async () => {
  const { disk } = await loadCase(caseById('fraud'))
  const inv = disk.inode(disk.resolve('/home/kvance/Documents/Invoices/invoice_HS-2231.docx'))
  expect(inv.btime).toBeLessThan(inv.fnBtime)
  const photo = disk.inodes().find((n) => n.name === 'IMG_2291.jpg')!
  const exif = Object.fromEntries(readExif(disk.read(photo.ino))!)
  expect(exif['GPSDateTime (UTC)']).toBe('2025:04:02 18:48:10')
  expect(exif.OffsetTimeOriginal).toBe('+01:00')
  const emb = carveEmbedded(disk.read(disk.resolve('/home/kvance/Pictures/receipt.jpg')))
  expect(unzipList(emb[0].bytes)!.map((e) => e.name)).toContain('bank_details.txt')
  expect(carveUnallocated(disk).some((c) => c.type === 'pdf' && td.decode(c.bytes).includes('17:38 UTC'))).toBe(true)
})
