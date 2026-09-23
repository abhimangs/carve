// AI mentor via OpenRouter (z-ai/glm-5.3-flash). Sees the answer key plus the trainee's live session (commands, output,
// recovered files, evidence board) and the chat so far, and guides a beginner step by step.
import { CASES } from '../../src/cases'
import { type Env, json, limited } from '../env'

const TOOLS = [
  'fls -r -d / (list deleted files with their inode numbers)',
  'istat <inode> (timestamps incl. hidden $FN copy, overwrite + timestomp warnings)',
  'icat <inode> (recover a deleted file into /recovered)',
  'cat / strings / grep <text> <file> (read files)',
  'carve (recover files whose inode was wiped, from free space)',
  'carve <file> (find a file hidden inside another file)',
  'exif <file> (photo EXIF incl. GPS time, or Word document metadata)',
  'unzip -l <zip> / unzip -p <zip> <entry>',
  'date -d @<epoch> (convert #epoch lines in bash history to UTC)',
  'hexdump, file, sha256sum, ls -la, cd',
  'tag <file> (put a file on the Evidence board; only tagged files score)',
].join('; ')

type Msg = { role: 'user' | 'assistant'; content: string }
type Ctx = { cwd?: string; commands?: { cmd: string; out: string }[]; recovered?: string[]; tagged?: string[]; found?: string[] }

const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n)

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json().catch(() => null)) as { caseId?: string; mode?: string; question?: string; history?: Msg[]; context?: Ctx; summary?: string } | null
  const c = CASES.find((x) => x.id === body?.caseId)
  if (!c || !body) return json({ error: 'bad request' }, 400)
  if (await limited(env, request, 'mentor', 20)) return json({ error: 'slow down' }, 429)

  const debrief = body.mode === 'debrief'
  const ctx = body.context ?? {}
  const found = new Set((ctx.found ?? []).slice(0, 20))
  const evidence = c.evidence
    .map((e) => {
      const how = 'carve' in e.find ? 'inode wiped: only `carve` finds it' : 'embedded' in e.find ? `hidden inside ${e.find.embedded}: use \`carve ${e.find.embedded}\`` : e.label.includes('deleted') ? `deleted file at ${e.find.path}: fls -d then icat` : `live file ${e.find.path}: just tag it`
      return `- [${found.has(e.id) ? 'ALREADY TAGGED' : 'NOT FOUND YET'}] ${e.label}. Event: ${e.event}. True time ${e.t}. How to get it: ${how}. Correct time source: ${e.timeSource}`
    })
    .join('\n')

  const session = [
    `Current directory: ${clip(ctx.cwd, 200) || '/'}`,
    `Recent terminal commands and output (oldest first):\n${(ctx.commands ?? []).slice(-12).map((x) => `$ ${clip(x.cmd, 160)}\n${clip(x.out, 500)}`).join('\n') || '(none yet)'}`,
    `Files recovered so far: ${(ctx.recovered ?? []).slice(0, 25).map((x) => clip(x, 160)).join('; ') || 'none'}`,
    `Evidence board: ${(ctx.tagged ?? []).slice(0, 25).map((x) => clip(x, 160)).join('; ') || 'empty'}`,
  ].join('\n\n')

  const system = [
    'You are the mentor inside Carve, a digital-forensics training game. Everything is fictional.',
    'The trainee may be a complete beginner who knows no forensics or Linux. Be friendly, plain-spoken and practical.',
    `Case "${c.title}" (${c.difficulty}). Brief: ${c.brief.join(' ')}`,
    `Terminal commands available: ${TOOLS}. Recovered files live under /recovered and are named <inode>_<name>. Tab completes names.`,
    'How the game works: find evidence (live, deleted, wiped or hidden files), recover it, run tag <file>, then in the Evidence tab drag cards into time order and pick each card\'s true UTC time from its dropdown (or type it manually), then press Submit findings. Tagging a decoy costs 3 points.',
    `ANSWER KEY (confidential):\n${evidence}\nDecoys (innocent, don't tag): ${c.decoys.map((d) => d.label).join('; ')}`,
    `TRAINEE'S LIVE SESSION:\n${session}`,
    debrief
      ? 'The case is over. Write a short debrief (max 140 words): one line on what they did well, then the most important misses and the exact commands that would have found each. You may now reveal everything.'
      : [
          'Guide them one step at a time based on what their session shows:',
          '- Read their recent commands and output. If a command failed or they misunderstood output, say so and correct it.',
          '- Give the concrete next step: the exact command(s) to type in `backticks`, with one short sentence on why. You may use inode numbers and filenames that already appear in their terminal output.',
          '- Prefer evidence NOT FOUND YET. If they recovered something but did not tag it, tell them to `tag` it. If they recovered a decoy, gently say it looks innocent. If everything is tagged, guide them to the Evidence tab to order cards and pick times.',
          '- Explain any term they ask about in one or two simple sentences.',
          '- Do not dump the full solution or the complete timeline unless they explicitly ask for the answer; then give it.',
          '- Keep answers under 120 words. Use short paragraphs or a short list. No headings.',
        ].join('\n'),
    'Never use em-dashes.',
  ].join('\n\n')

  const history = (body.history ?? [])
    .slice(-8)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: clip(m.content, 800) }))
  const messages = debrief
    ? [{ role: 'system', content: system }, { role: 'user', content: `My results:\n${clip(body.summary, 2000)}` }]
    : [{ role: 'system', content: system }, ...history, { role: 'user', content: clip(body.question, 500) }]

  const clean = (a?: string) => a?.trim().replace(/\s*[\u2014\u2013]\s*/g, ', ')

  // Cost guard: a daily USD budget tracked in KV from OpenRouter's reported per-call cost.
  // Over budget, the mentor keeps working on Workers AI instead of spending more.
  const day = `spend:${new Date().toISOString().slice(0, 10)}`
  const spent = Number(await env.LEADERBOARD.get(day)) || 0
  const budget = Number(env.MENTOR_DAILY_USD) || 1

  if (env.OPENROUTER_API && spent < budget) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { authorization: `Bearer ${env.OPENROUTER_API}`, 'content-type': 'application/json', 'x-title': 'Carve' },
          body: JSON.stringify({
            model: env.MENTOR_MODEL,
            messages,
            // Reasoning can't be disabled on this model; "minimal" keeps billed reasoning tokens at ~0.
            reasoning: { effort: 'minimal', exclude: true },
            usage: { include: true },
            max_tokens: debrief ? 600 : 450,
            temperature: 0.3,
          }),
          signal: AbortSignal.timeout(15000),
        })
        if (r.ok) {
          const d = (await r.json()) as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number } }
          // ponytail: read-modify-write on one KV key, so concurrent calls can undercount a little. Set a hard credit limit on the OpenRouter key too.
          if (d.usage?.cost) await env.LEADERBOARD.put(day, String(spent + d.usage.cost), { expirationTtl: 3 * 86400 })
          const answer = clean(d.choices?.[0]?.message?.content)
          if (answer) return json({ answer, via: 'openrouter', cost: d.usage?.cost })
        }
        if (r.status < 500 && r.status !== 429) break
      } catch {
        break // timeout: fall back rather than make the trainee wait longer
      }
      await new Promise((res) => setTimeout(res, 600))
    }
  }
  try {
    const out = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as keyof AiModels, { messages, max_tokens: 600, temperature: 0.3 } as never)) as { response?: string }
    const answer = clean(out.response)
    return answer ? json({ answer, via: 'workers-ai' }) : json({ error: 'empty answer' }, 502)
  } catch {
    return json({ error: 'mentor unavailable' }, 503)
  }
}
