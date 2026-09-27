// Small presentational pieces shared by more than one screen, so they are not exported out of Workspace.
export function Difficulty({ d }: { d: string }) {
  const color = d === 'Easy' ? 'text-ok border-ok/40' : d === 'Medium' ? 'text-amber border-amber/40' : 'text-bad border-bad/40'
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${color}`}>
      {d}
    </span>
  )
}

/** Tiny markdown: paragraphs, bullet/numbered lists, ``` blocks, `code` and **bold**. Renders text nodes only, so
 *  nothing an AI returns can inject markup. */
export function Md({ s: raw, inline }: { s: unknown; inline?: boolean }) {
  const s = typeof raw === 'string' ? raw : String(raw ?? '')
  const span = (t: string, k: number | string) =>
    t.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((p, i) =>
      p.startsWith('`') ? (
        <code key={`${k}-${i}`} className="rounded bg-raised px-1 py-0.5 font-mono text-[12px] text-amber">
          {p.slice(1, -1)}
        </code>
      ) : p.startsWith('**') ? (
        <strong key={`${k}-${i}`} className="font-semibold text-ink">
          {p.slice(2, -2)}
        </strong>
      ) : (
        p
      ),
    )
  if (inline) return <>{span(s, 0)}</>
  const out: React.ReactNode[] = []
  let code: string[] | null = null
  s
    .trim()
    .split('\n')
    .forEach((line, i) => {
      if (line.startsWith('```')) {
        if (code) {
          out.push(
            <pre key={i} className="my-2 overflow-auto rounded-md border border-line bg-bg p-2.5 font-mono text-[12px] text-amber">
              {code.join('\n')}
            </pre>,
          )
          code = null
        } else code = []
        return
      }
      if (code) return void code.push(line)
      const li = /^\s*(?:[-*]|\d+[.)])\s+(.*)/.exec(line)
      if (li)
        out.push(
          <div key={i} className="relative my-1 pl-4 before:absolute before:left-0 before:text-amber before:content-['›']">
            {span(li[1], i)}
          </div>,
        )
      else if (line.trim()) out.push(<p key={i} className="my-1.5">{span(line, i)}</p>)
    })
  return <>{out}</>
}
