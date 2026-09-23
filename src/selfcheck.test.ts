// bun test: every case's image must be self-consistent with its answer key.
import { expect, test } from 'bun:test'
import { CASES, loadCase } from './cases'
import { carveEmbedded, carveUnallocated } from './fs/carve'
import { readExif, unzipList } from './fs/formats'
import { td } from './fs/bytes'
import { score } from './score'

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

    const perfect = { tagged: shas, timeline: [...key.evidence].sort((a, b) => a.truth - b.truth).map((e) => ({ sha: e.sha, t: e.truth })), hints: 0 }
    expect(score(key, perfect).total).toBe(100)
    expect(score(key, { tagged: [], timeline: [], hints: 0 }).total).toBe(0)

    // One adjacent swap loses exactly one of n(n-1)/2 pairs.
    const n = shas.length
    const swapped = [...perfect.timeline]
    ;[swapped[0], swapped[1]] = [swapped[1], swapped[0]]
    const order = score(key, { ...perfect, timeline: swapped }).parts[1]
    expect(order.pts).toBeCloseTo((25 * (n * (n - 1) / 2 - 1)) / (n * (n - 1) / 2))

    // Decoys cost points.
    expect(score(key, { ...perfect, tagged: [...shas, key.decoys[0].sha] }).total).toBe(97)
  })
}

test('insider: deleted history recoverable, zip readable', async () => {
  const { disk } = await loadCase(CASES[0])
  const old = disk.inodes().find((n) => n.deleted && n.name === '.bash_history')!
  expect(td.decode(disk.read(old.ino))).toContain('dropshare.io')
  const z = disk.inodes().find((n) => n.name === 'q3_clients.zip')!
  expect(unzipList(disk.read(z.ino))!.map((e) => e.name)).toEqual(['clients_q3.csv', 'pricing_2025.csv'])
})

test('ransomware: auth.log partly overwritten, zip only carvable', async () => {
  const { disk } = await loadCase(CASES[1])
  const auth = disk.inodes().find((n) => n.name === 'auth.log')!
  expect(disk.overwritten(auth.ino).length).toBeGreaterThan(0)
  const text = td.decode(disk.read(auth.ino))
  expect(text).toContain('Accepted password')
  expect(text).not.toContain('02:10:14') // first failures destroyed by the overwrite
  expect(disk.inodes().some((n) => n.name === 'f.zip')).toBe(false)
  expect(carveUnallocated(disk).some((c) => c.type === 'zip' && unzipList(c.bytes)!.some((e) => e.name === 'manifest.txt'))).toBe(true)
})

test('fraud: timestomp visible, EXIF + embedded zip', async () => {
  const { disk } = await loadCase(CASES[2])
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
