// Real file formats, built from scratch so evidence bytes are genuine:
// ZIP (stored), JPEG EXIF (TIFF IFDs), DOCX (zip + core.xml), PDF.
import { b64, concat, crc32, indexOf, latin1, td, te, toBytes, u16, u32, w16, w32 } from './bytes'

/* ---------------- ZIP ---------------- */

export type ZipIn = { name: string; data: Uint8Array | string; mtime: string /* local wall-clock 'YYYY-MM-DD HH:MM:SS' */ }

function dos(mtime: string) {
  const [d, t] = mtime.split(' ')
  const [y, mo, da] = d.split('-').map(Number)
  const [h, mi, s] = t.split(':').map(Number)
  return { time: (h << 11) | (mi << 5) | (s >> 1), date: ((y - 1980) << 9) | (mo << 5) | da }
}

export function zip(files: ZipIn[]) {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let off = 0
  for (const f of files) {
    const data = toBytes(f.data)
    const name = te.encode(f.name)
    const crc = crc32(data)
    const { time, date } = dos(f.mtime)
    const lh = new Uint8Array(30)
    w32(lh, 0, 0x04034b50); w16(lh, 4, 20); w16(lh, 10, time); w16(lh, 12, date)
    w32(lh, 14, crc); w32(lh, 18, data.length); w32(lh, 22, data.length); w16(lh, 26, name.length)
    const ch = new Uint8Array(46)
    w32(ch, 0, 0x02014b50); w16(ch, 4, 20); w16(ch, 6, 20); w16(ch, 12, time); w16(ch, 14, date)
    w32(ch, 16, crc); w32(ch, 20, data.length); w32(ch, 24, data.length); w16(ch, 28, name.length); w32(ch, 42, off)
    locals.push(lh, name, data)
    centrals.push(ch, name)
    off += 30 + name.length + data.length
  }
  const cd = concat(...centrals)
  const eocd = new Uint8Array(22)
  w32(eocd, 0, 0x06054b50); w16(eocd, 8, files.length); w16(eocd, 10, files.length)
  w32(eocd, 12, cd.length); w32(eocd, 16, off)
  return concat(...locals, cd, eocd)
}

export type ZipEntry = { name: string; size: number; crc: number; mtime: string; offset: number }

export function unzipList(b: Uint8Array): ZipEntry[] | null {
  let e = -1
  for (let i = b.length - 22; i >= 0; i--) if (u32(b, i) === 0x06054b50) { e = i; break }
  if (e < 0) return null
  const n = u16(b, e + 10)
  let p = u32(b, e + 16)
  const out: ZipEntry[] = []
  for (let i = 0; i < n && p + 46 <= b.length && u32(b, p) === 0x02014b50; i++) {
    const time = u16(b, p + 12), date = u16(b, p + 14)
    const nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32)
    const pad = (x: number) => String(x).padStart(2, '0')
    out.push({
      name: td.decode(b.subarray(p + 46, p + 46 + nl)),
      size: u32(b, p + 24),
      crc: u32(b, p + 16),
      mtime: `${(date >> 9) + 1980}-${pad((date >> 5) & 15)}-${pad(date & 31)} ${pad(time >> 11)}:${pad((time >> 5) & 63)}:${pad((time & 31) * 2)}`,
      offset: u32(b, p + 42),
    })
    p += 46 + nl + xl + cl
  }
  return out
}

export function unzipRead(b: Uint8Array, name: string) {
  const e = unzipList(b)?.find((x) => x.name === name)
  if (!e) return null
  const p = e.offset
  const start = p + 30 + u16(b, p + 26) + u16(b, p + 28)
  return b.slice(start, start + e.size)
}

/* ---------------- JPEG + EXIF ---------------- */

export type Exif = {
  make: string
  model: string
  dateTimeOriginal: string // 'YYYY:MM:DD HH:MM:SS' camera local time, no zone
  offsetTimeOriginal?: string // '+05:30'
  gps?: { lat: number; lon: number; utc: string /* 'YYYY:MM:DD HH:MM:SS' */ }
  software?: string
}

type Ent = { tag: number; type: 2 | 3 | 4 | 5; v: string | number[] | [number, number][] }

function encodeVal(e: Ent) {
  if (e.type === 2) return { count: (e.v as string).length + 1, bytes: te.encode((e.v as string) + '\0') }
  if (e.type === 5) {
    const r = e.v as [number, number][]
    const b = new Uint8Array(r.length * 8)
    r.forEach(([n, d], i) => { w32(b, i * 8, n); w32(b, i * 8 + 4, d) })
    return { count: r.length, bytes: b }
  }
  const nums = e.v as number[]
  const sz = e.type === 3 ? 2 : 4
  const b = new Uint8Array(nums.length * sz)
  nums.forEach((x, i) => (sz === 2 ? w16(b, i * 2, x) : w32(b, i * 4, x)))
  return { count: nums.length, bytes: b }
}

const ifdSize = (es: Ent[]) =>
  6 + 12 * es.length + es.reduce((n, e) => { const l = encodeVal(e).bytes.length; return n + (l > 4 ? l + (l & 1) : 0) }, 0)

function writeIfd(es: Ent[], at: number) {
  const out = new Uint8Array(ifdSize(es))
  w16(out, 0, es.length)
  let data = 2 + 12 * es.length + 4
  es.sort((a, b) => a.tag - b.tag).forEach((e, i) => {
    const p = 2 + i * 12
    const { count, bytes } = encodeVal(e)
    w16(out, p, e.tag); w16(out, p + 2, e.type); w32(out, p + 4, count)
    if (bytes.length <= 4) out.set(bytes, p + 8)
    else { w32(out, p + 8, at + data); out.set(bytes, data); data += bytes.length + (bytes.length & 1) }
  })
  return out
}

const dms = (x: number): [number, number][] => {
  const a = Math.abs(x), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 100)
  return [[d, 1], [m, 1], [s, 100]]
}

export function jpegWithExif(jpegB64: string, x: Exif) {
  const jpg = b64(jpegB64)
  const ifd0: Ent[] = [
    { tag: 0x010f, type: 2, v: x.make },
    { tag: 0x0110, type: 2, v: x.model },
    ...(x.software ? [{ tag: 0x0131, type: 2 as const, v: x.software }] : []),
    { tag: 0x0132, type: 2, v: x.dateTimeOriginal },
    { tag: 0x8769, type: 4, v: [0] },
    ...(x.gps ? [{ tag: 0x8825, type: 4 as const, v: [0] }] : []),
  ]
  const exif: Ent[] = [
    { tag: 0x9003, type: 2, v: x.dateTimeOriginal },
    ...(x.offsetTimeOriginal ? [{ tag: 0x9011, type: 2 as const, v: x.offsetTimeOriginal }] : []),
  ]
  const gps: Ent[] = x.gps
    ? (() => {
        const [d, t] = x.gps.utc.split(' ')
        return [
          { tag: 1, type: 2, v: x.gps.lat >= 0 ? 'N' : 'S' },
          { tag: 2, type: 5, v: dms(x.gps.lat) },
          { tag: 3, type: 2, v: x.gps.lon >= 0 ? 'E' : 'W' },
          { tag: 4, type: 5, v: dms(x.gps.lon) },
          { tag: 7, type: 5, v: t.split(':').map((n) => [Number(n), 1] as [number, number]) },
          { tag: 0x1d, type: 2, v: d },
        ] as Ent[]
      })()
    : []
  const exifOff = 8 + ifdSize(ifd0)
  const gpsOff = exifOff + ifdSize(exif)
  ifd0.find((e) => e.tag === 0x8769)!.v = [exifOff]
  if (x.gps) ifd0.find((e) => e.tag === 0x8825)!.v = [gpsOff]
  const tiff = concat(
    new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]),
    writeIfd(ifd0, 8),
    writeIfd(exif, exifOff),
    x.gps ? writeIfd(gps, gpsOff) : new Uint8Array(),
  )
  const hdr = te.encode('Exif\0\0')
  const len = 2 + hdr.length + tiff.length
  const app1 = concat(new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff]), hdr, tiff)
  return concat(jpg.subarray(0, 2), app1, jpg.subarray(2))
}

const TAGS: Record<number, string> = {
  0x010f: 'Make', 0x0110: 'Model', 0x0131: 'Software', 0x0132: 'ModifyDate',
  0x9003: 'DateTimeOriginal', 0x9011: 'OffsetTimeOriginal',
  1: 'GPSLatitudeRef', 2: 'GPSLatitude', 3: 'GPSLongitudeRef', 4: 'GPSLongitude', 7: 'GPSTimeStamp', 0x1d: 'GPSDateStamp',
}

/** Parses EXIF from a JPEG. Returns ordered [tag, value] pairs, or null if no EXIF. */
export function readExif(b: Uint8Array): [string, string][] | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  let p = 2
  while (p + 4 < b.length && b[p] === 0xff) {
    const m = b[p + 1], len = (b[p + 2] << 8) | b[p + 3]
    if (m === 0xda) break
    if (m === 0xe1 && latin1.decode(b.subarray(p + 4, p + 10)) === 'Exif\0\0') return parseTiff(b.subarray(p + 10, p + 2 + len))
    p += 2 + len
  }
  return null
}

function parseTiff(t: Uint8Array): [string, string][] {
  const le = t[0] === 0x49
  const r16 = (o: number) => (le ? u16(t, o) : (t[o] << 8) | t[o + 1])
  const r32 = (o: number) => (le ? u32(t, o) : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0)
  const out: [string, string][] = []
  const walk = (off: number) => {
    const n = r16(off)
    for (let i = 0; i < n; i++) {
      const p = off + 2 + i * 12
      const tag = r16(p), type = r16(p + 2), count = r32(p + 4)
      const size = count * ({ 2: 1, 3: 2, 4: 4, 5: 8 } as Record<number, number>)[type]
      const vo = size > 4 ? r32(p + 8) : p + 8
      if (tag === 0x8769 || tag === 0x8825) { walk(r32(p + 8)); continue }
      let v: string
      if (type === 2) v = latin1.decode(t.subarray(vo, vo + count - 1))
      else if (type === 5) {
        const rs = Array.from({ length: count }, (_, k) => r32(vo + k * 8) / r32(vo + k * 8 + 4))
        v = tag === 7 ? rs.map((x) => String(Math.round(x)).padStart(2, '0')).join(':') : `${rs[0]} deg ${rs[1]}' ${rs[2].toFixed(2)}"`
      } else v = String(type === 3 ? r16(vo) : r32(vo))
      out.push([TAGS[tag] ?? `0x${tag.toString(16)}`, v])
    }
  }
  walk(r32(4))
  const get = (k: string) => out.find(([n]) => n === k)?.[1]
  const lat = get('GPSLatitude'), lon = get('GPSLongitude')
  if (lat && lon) {
    const dec = (s: string) => { const [d, m, x] = s.match(/[\d.]+/g)!.map(Number); return d + m / 60 + x / 3600 }
    const la = dec(lat) * (get('GPSLatitudeRef') === 'S' ? -1 : 1), lo = dec(lon) * (get('GPSLongitudeRef') === 'W' ? -1 : 1)
    out.push(['GPSPosition', `${la.toFixed(5)}, ${lo.toFixed(5)}`])
    out.push(['GPSDateTime (UTC)', `${get('GPSDateStamp')} ${get('GPSTimeStamp')}`])
  }
  return out
}

/* ---------------- DOCX ---------------- */

export type DocMeta = { creator: string; lastModifiedBy: string; revision: number; created: string; modified: string; title?: string }

export function docx(body: string[], m: DocMeta, zipTime: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const files: ZipIn[] = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: 'docProps/core.xml', data: `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>${esc(m.title ?? '')}</dc:title><dc:creator>${esc(m.creator)}</dc:creator><cp:lastModifiedBy>${esc(m.lastModifiedBy)}</cp:lastModifiedBy><cp:revision>${m.revision}</cp:revision><dcterms:created>${m.created}</dcterms:created><dcterms:modified>${m.modified}</dcterms:modified></cp:coreProperties>` },
    { name: 'word/document.xml', data: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.map((l) => `<w:p><w:r><w:t>${esc(l)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>` },
  ].map((f) => ({ ...f, mtime: zipTime }))
  return zip(files)
}

export function readDocx(b: Uint8Array): { meta: [string, string][]; text: string } | null {
  const core = unzipRead(b, 'docProps/core.xml')
  if (!core) return null
  const xml = td.decode(core)
  const meta = [...xml.matchAll(/<(?:dc|cp|dcterms):(\w+)>([^<]*)</g)].map(([, k, v]) => [k, v] as [string, string])
  const doc = unzipRead(b, 'word/document.xml')
  const text = doc ? [...td.decode(doc).matchAll(/<w:t>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('\n') : ''
  return { meta, text }
}

/* ---------------- PDF ---------------- */

export function pdf(lines: string[]) {
  const content = `BT /F1 11 Tf 40 780 Td 14 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) '`).join(' ')} ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ]
  let s = '%PDF-1.4\n'
  const offs: number[] = []
  objs.forEach((o, i) => { offs.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const x = s.length
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`
  return te.encode(s)
}

/** Best-effort file type sniffing, like `file(1)`. */
export function sniff(b: Uint8Array) {
  if (b.length === 0) return 'empty'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'JPEG image data' + (readExif(b) ? ', Exif standard' : '')
  if (latin1.decode(b.subarray(0, 5)) === '%PDF-') return 'PDF document, version ' + latin1.decode(b.subarray(5, 8))
  if (u32(b, 0) === 0x04034b50) return indexOf(b, te.encode('word/document.xml')) >= 0 ? 'Microsoft Word 2007+' : 'Zip archive data, v2.0 to extract, stored'
  if (b[0] === 0x23 && b[1] === 0x21) return 'script, ASCII text executable'
  const printable = b.subarray(0, 512).every((c) => c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 0xc2)
  return printable ? 'ASCII text' : 'data'
}
