export const te = new TextEncoder()
export const td = new TextDecoder('utf-8', { fatal: false })
export const latin1 = new TextDecoder('latin1')

export const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
export const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
export function w16(b: Uint8Array, o: number, v: number) {
  b[o] = v & 0xff
  b[o + 1] = (v >>> 8) & 0xff
}
export function w32(b: Uint8Array, o: number, v: number) {
  for (let i = 0; i < 4; i++) b[o + i] = (v >>> (8 * i)) & 0xff
}

export function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export const toBytes = (d: Uint8Array | string) => (typeof d === 'string' ? te.encode(d) : d)

export function b64(s: string) {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function indexOf(hay: Uint8Array, needle: number[] | Uint8Array, from = 0) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
export function crc32(b: Uint8Array) {
  let c = 0xffffffff
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export async function sha256(b: Uint8Array) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** '2024-03-14T09:12:00Z' -> unix seconds */
export const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000)
/** unix seconds -> '2024-03-14 09:12:00 UTC' */
export const fmtTime = (t: number) => (t ? new Date(t * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '-')

/** Epoch line as bash writes it into a history file when HISTTIMEFORMAT is set. */
export const ep = (iso: string) => `#${unix(iso)}`
