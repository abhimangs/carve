// AI mentor on NVIDIA NIM. Knows the answer key, is instructed to coach method, not reveal answers.
import { CASES } from '../../src/cases'
import { type Env, json, limited } from '../env'

const TOOLS = 'ls -a, cd, cat, file, fls -r -d (deleted entries), istat <inode> ($SI vs $FN times, overwritten blocks), icat <inode> (recover), blkls, carve (unallocated space), carve <file> (embedded files), hexdump, strings, grep, exif (JPEG EXIF / docx core.xml), unzip -l/-p, sha256sum, date -d @<epoch>, tag <file>'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json().catch(() => null)) as { caseId?: string; mode?: string; question?: string; found?: string[]; summary?: string } | null
  const c = CASES.find((x) => x.id === body?.caseId)
  if (!c || !body) return json({ error: 'bad request' }, 400)
  if (!env.NIM_API_KEY) return json({ error: 'mentor not configured' }, 503)
  if (await limited(env, request, 'mentor', 12)) return json({ error: 'slow down' }, 429)

  const debrief = body.mode === 'debrief'
  const found = new Set((body.found ?? []).slice(0, 20))
  const evidence = c.evidence
    .map((e) => `- [${found.has(e.id) ? 'FOUND' : 'not yet found'}] ${e.label}: ${e.event} at ${e.t}. How to recover: ${'carve' in e.find ? 'inode wiped, only carving unallocated space finds it' : 'embedded' in e.find ? 'hidden inside ' + e.find.embedded + ', use carve <file>' : e.label.includes('deleted') ? 'deleted, fls -d then icat' : 'live file, just tag it'}. Correct time source: ${e.timeSource}`)
    .join('\n')

  const system = [
    'You are the mentor inside Carve, a digital forensics training simulator. The disk image is fictional.',
    `Case "${c.title}" (${c.difficulty}). Brief: ${c.brief.join(' ')}`,
    `Terminal tools available: ${TOOLS}. Recovered files appear under /recovered.`,
    `ANSWER KEY (confidential):\n${evidence}`,
    `Decoys (look suspicious, are not evidence): ${c.decoys.map((d) => d.label).join('; ')}`,
    debrief
      ? 'The case is over. Write a debrief of at most 130 words for the trainee: one line on what they did well, then the two most important misses and the exact technique that would have caught each. You may now reveal answers. Plain text, commands in `backticks`.'
      : 'Coach the trainee. Give exactly ONE next step as a short paragraph (max 60 words, no lists, no headings). NEVER reveal filenames, paths, inode numbers, timestamps or conclusions from the answer key: point at the technique or kind of artefact instead, and end with a question that makes them think. Prefer evidence not yet found. Only suggest tools from the list above. Commands in `backticks`. If the question is unrelated to forensics, steer back to the case.',
    'Never use em-dashes.',
  ].join('\n\n')
  const user = debrief ? `My results:\n${String(body.summary ?? '').slice(0, 2000)}` : String(body.question ?? '').slice(0, 400)

  const call = () =>
    fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.NIM_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.MENTOR_MODEL, chat_template_kwargs: { enable_thinking: false }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: debrief ? 900 : 600, temperature: 0.4 }),
      signal: AbortSignal.timeout(14000),
    })
  try {
    let r = await call()
    if (r.status >= 500) r = await call() // NIM has occasional transient 503s
    if (!r.ok) return json({ error: `upstream ${r.status}` }, 502)
    const d = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    const answer = d.choices?.[0]?.message?.content?.trim().replace(/\s*[—–]\s*/g, ', ')
    return answer ? json({ answer }) : json({ error: 'empty answer' }, 502)
  } catch {
    return json({ error: 'mentor timeout' }, 504)
  }
}
