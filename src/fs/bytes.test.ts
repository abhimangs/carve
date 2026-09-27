// bun test: the byte primitives every other module is built on.
import { describe, expect, test } from 'bun:test'
import { b64, concat, crc32, ep, fmtTime, indexOf, latin1, sha256, td, te, toBytes, u16, u32, unix, w16, w32 } from './bytes'

describe('sha256', () => {
  test('the empty input digest', async () => {
    expect(await sha256(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  test('"abc" and a repeated byte string', async () => {
    expect(await sha256(te.encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256(new Uint8Array(1000).fill(0x41))).toBe(await sha256(te.encode('A'.repeat(1000))))
  })

  test('the output is lower-case hex, 64 chars', async () => {
    const h = await sha256(te.encode('x'))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('unix', () => {
  test('the ISO Z format the cases use', () => {
    expect(unix('2025-03-13T23:03:10Z')).toBe(1741906990)
    expect(unix('1970-01-01T00:00:00Z')).toBe(0)
    expect(unix('2024-02-29T12:00:00Z')).toBe(1709208000)
  })

  test('a string with no zone is rejected rather than read as local time', () => {
    // Reading it as local time shifted a truth time by the build machine's offset, so a single missing Z in a
    // case file silently moved the answer. NaN makes the case unbuildable instead.
    expect(unix('2025-03-13T23:03:10')).toBeNaN()
    expect(unix('2025-03-13 23:03:10')).toBeNaN()
    expect(unix('2025-03-13T23:03:10z')).toBe(1741906990)
  })

  test('garbage and out-of-range components give NaN', () => {
    expect(unix('nope')).toBeNaN()
    expect(unix('')).toBeNaN()
    expect(unix('2025-13-45T99:99:99Z')).toBeNaN()
  })

  test('ep writes a literal epoch marker, not a date unix() can parse', () => {
    expect(ep('2025-03-13T23:03:10Z')).toBe('#1741906990')
    expect(Number(ep('2025-03-13T23:03:10Z').slice(1))).toBe(unix('2025-03-13T23:03:10Z'))
    expect(unix('#1741906990')).toBeNaN()
  })
})

describe('fmtTime', () => {
  test('seconds render as "<iso> UTC", 0 renders as a dash', () => {
    expect(fmtTime(1741906990)).toBe('2025-03-13 23:03:10 UTC')
    expect(fmtTime(0)).toBe('-')
  })

  test('a sub-second value keeps the UTC marker, because the millisecond field is matched not literal-matched', () => {
    expect(fmtTime(1741906990.5)).toBe('2025-03-13 23:03:10 UTC')
  })
})

describe('text decoding', () => {
  test('td is UTF-8, so bytes above 0x7f become replacement characters', () => {
    expect(td.decode(new Uint8Array([0x41, 0x42]))).toBe('AB')
    expect(td.decode(new Uint8Array([0x41, 0xe9]))).toBe('A\uFFFD')
    expect(td.decode(te.encode('Aéÿ'))).toBe('Aéÿ')
  })

  test('latin1 is one char per byte and keeps every value, NULs included', () => {
    const b = new Uint8Array([0x41, 0xe9, 0xff, 0x00, 0x42])
    expect(latin1.decode(b)).toBe('Aéÿ\u0000B')
    expect(latin1.decode(b).length).toBe(5)
    expect(latin1.decode(b)).not.toBe(td.decode(b))
  })

  test('latin1 decodes longer buffers than the spread call can take', () => {
    expect(latin1.decode(new Uint8Array(4096).fill(0x80)).length).toBe(4096)
  })

  test('toBytes passes bytes through and encodes strings', () => {
    const b = new Uint8Array([1, 2])
    expect(toBytes(b)).toBe(b)
    expect(toBytes('hi')).toEqual(te.encode('hi'))
    expect(te.encode('hi')).toEqual(new Uint8Array([104, 105]))
  })

  test('b64 decodes standard base64', () => {
    expect(b64('aGk=')).toEqual(new Uint8Array([104, 105]))
    expect(b64('')).toEqual(new Uint8Array(0))
  })
})

describe('crc32', () => {
  test('the standard check value for "123456789"', () => {
    expect(crc32(te.encode('123456789'))).toBe(0xcbf43926)
  })

  test('empty input is 0 and "a" is the published 0xe8b7be43', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
    expect(crc32(te.encode('a'))).toBe(0xe8b7be43)
  })

  test('bytes with the high bit set still hash', () => {
    expect(crc32(new Uint8Array([0x00, 0xff, 0x80, 0x7f]))).toBe(crc32(new Uint8Array([0x00, 0xff, 0x80, 0x7f])))
    expect(crc32(new Uint8Array([0xff]))).not.toBe(crc32(new Uint8Array([0x00])))
  })
})

describe('little-endian accessors', () => {
  test('u16 and u32 read little-endian, and ignore trailing bytes', () => {
    const b = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xff])
    expect(u16(b, 0)).toBe(0x0201)
    expect(u16(b, 1)).toBe(0x0302)
    expect(u32(b, 0)).toBe(0x04030201)
    expect(u32(b, 1)).toBe(0xff040302)
  })

  test('u32 never returns a negative number', () => {
    expect(u32(new Uint8Array([0, 0, 0, 0x80]), 0)).toBe(0x80000000)
    expect(u32(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 0)).toBe(0xffffffff)
  })

  test('w16 and w32 round-trip through the readers', () => {
    const b = new Uint8Array(10)
    w16(b, 0, 0xbeef)
    w32(b, 2, 0xdeadbeef)
    w32(b, 6, 0xffffffff)
    expect(u16(b, 0)).toBe(0xbeef)
    expect(u32(b, 2)).toBe(0xdeadbeef)
    expect(u32(b, 6)).toBe(0xffffffff)
  })

  test('a write that runs off the end of the buffer throws instead of corrupting a field', () => {
    const b = new Uint8Array(4)
    expect(() => w32(b, 2, 0xdeadbeef)).toThrow(RangeError)
    expect(() => w32(b, -1, 0)).toThrow(RangeError)
    expect(() => w16(new Uint8Array(1), 0, 1)).toThrow(RangeError)
    expect([...b]).toEqual([0, 0, 0, 0])
  })
})

describe('buffer helpers', () => {
  test('concat joins in order and handles no parts', () => {
    expect(concat(new Uint8Array([1, 2]), new Uint8Array(0), new Uint8Array([3]))).toEqual(new Uint8Array([1, 2, 3]))
    expect(concat()).toEqual(new Uint8Array(0))
  })

  test('indexOf finds a byte or a byte sequence, and reports -1 when absent', () => {
    const h = te.encode('hello world')
    expect(indexOf(h, te.encode('world'))).toBe(6)
    expect(indexOf(h, te.encode('o'))).toBe(4)
    expect(indexOf(h, te.encode('z'))).toBe(-1)
    expect(indexOf(h, te.encode('l'), 5)).toBe(9)
    expect(indexOf(te.encode('ab'), te.encode('abc'))).toBe(-1)
  })
})
