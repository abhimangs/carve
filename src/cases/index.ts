import { sha256, unix } from '../fs/bytes'
import { carveEmbedded, carveUnallocated } from '../fs/carve'
import { buildImage, type Op } from '../fs/image'
import { BS, Disk } from '../fs/reader'
import { insider } from './insider'
import { ransomware } from './ransomware'
import { fraud } from './fraud'

/** Where the trainee must recover an artifact from. Answer keys are computed with the same code the terminal uses. */
export type Locator =
  | { path: string } // inode last written at this path, or a write op's `as` alias (live or deleted): `icat` / `cat`
  | { carve: string } // inode wiped; only carving unallocated space finds it
  | { embedded: string } // hidden inside the live file at this path

export type Evidence = {
  id: string
  label: string
  find: Locator
  event: string // what happened, as it appears on the true timeline
  t: string // ISO UTC truth time of the event
  timeSource: string // where the correct timestamp comes from (for the debrief)
  why: string // why it matters
}

export type Case = {
  id: string
  title: string
  difficulty: 'Easy' | 'Medium' | 'Hard'
  label: string // volume label
  brief: string[]
  objectives: string[]
  ops: Op[]
  evidence: Evidence[]
  decoys: { label: string; find: Locator; why: string }[]
  hints: string[]
}

export const CASES: Case[] = [insider, ransomware, fraud]

export type KeyItem = { sha: string; label: string; why: string }
export type Key = {
  evidence: (Evidence & { sha: string; truth: number })[]
  decoys: KeyItem[]
}

export type Loaded = { c: Case; disk: Disk; key: Key }

function locate(disk: Disk, built: ReturnType<typeof buildImage>, f: Locator) {
  if ('path' in f) return disk.read(built.inoOf[f.path])
  if ('carve' in f) {
    const hit = carveUnallocated(disk).find((c) => c.offset === built.startOf[f.carve] * BS)
    if (!hit) throw new Error(`answer key: ${f.carve} is not carvable`)
    return hit.bytes
  }
  const hit = carveEmbedded(disk.read(built.inoOf[f.embedded]))[0]
  if (!hit) throw new Error(`answer key: nothing embedded in ${f.embedded}`)
  return hit.bytes
}

export async function loadCase(c: Case): Promise<Loaded> {
  const built = buildImage(c.label, c.ops)
  const disk = new Disk(built.bytes)
  const evidence = await Promise.all(
    c.evidence.map(async (e) => ({ ...e, sha: await sha256(locate(disk, built, e.find)), truth: unix(e.t) })),
  )
  const decoys = await Promise.all(
    c.decoys.map(async (d) => ({ label: d.label, why: d.why, sha: await sha256(locate(disk, built, d.find)) })),
  )
  return { c, disk, key: { evidence, decoys } }
}
