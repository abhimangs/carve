// Builds public/cases/<id>.img from the case scripts so the browser can be
// shipped disk images instead of the answer key. `buildImage` is deterministic,
// so `--check` proves the committed images still match the case scripts.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CASES } from '../src/cases'
import { buildImage } from '../src/fs/image'

const OUT_DIR = join(import.meta.dir, '..', 'public', 'cases')
const mode = process.argv[2] ?? 'gen'
const check = mode === '--check'

if (mode !== 'gen' && !check) {
  console.error(`usage: bun scripts/gen-images.ts [gen|--check]`)
  process.exit(2)
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 16)

if (!check) mkdirSync(OUT_DIR, { recursive: true })

let drift = false
for (const c of CASES) {
  const { bytes } = buildImage(c.label, c.ops)
  const file = join(OUT_DIR, `${c.id}.img`)
  if (check) {
    if (!existsSync(file)) {
      console.log(`FAIL ${c.id}: missing ${file}`)
      drift = true
      continue
    }
    const onDisk = readFileSync(file)
    const same = onDisk.length === bytes.length && onDisk.every((b, i) => b === bytes[i])
    if (same) console.log(`PASS ${c.id}: ${bytes.length} bytes, sha ${sha(bytes)}`)
    else {
      console.log(`FAIL ${c.id}: committed sha ${sha(onDisk)} (${onDisk.length} B) != regenerated sha ${sha(bytes)} (${bytes.length} B)`)
      drift = true
    }
  } else {
    writeFileSync(file, bytes)
    console.log(`${c.id}  ${bytes.length} bytes  sha ${sha(bytes)}  -> public/cases/${c.id}.img`)
  }
}

if (check) process.exit(drift ? 1 : 0)
