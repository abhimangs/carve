/**
 * The only case module the browser may import.
 *
 * The client gets the manifest and a prebuilt 256 KiB CarveFS image, never the
 * case scripts. ops, evidence times, decoys and hints stay on the server, so the
 * answer key cannot be read out of the shipped bundle.
 *
 * Must not import ./index or any case file, and must not pull in ../score.
 */
import { Disk } from '../fs/reader'
import { CASE_META, type CaseMeta } from './meta'

export { CASE_META, type CaseMeta }

export type Loaded = { meta: CaseMeta; disk: Disk }

/** The image bytes are immutable for a given case id, so they are safe to cache forever. */
export async function loadImage(id: string): Promise<Loaded> {
  const meta = CASE_META.find((m) => m.id === id)
  if (!meta) throw new Error(`unknown case id: ${id}`)
  const r = await fetch(`/cases/${id}.img`)
  if (!r.ok) throw new Error(`image fetch failed for ${id}: HTTP ${r.status}`)
  const buf = await r.arrayBuffer()
  return { meta, disk: new Disk(new Uint8Array(buf)) }
}
