import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { C, type Ctx, complete, run } from '../term/commands'

const prompt = (cwd: string) => `\x1b[32mexaminer@carve\x1b[0m:\x1b[34m${cwd}\x1b[0m$ `

/** xterm front-end for the command layer. `ctx` is mutable session state owned by the parent. */
export default function Terminal({ ctx, banner, onRan, inject }: { ctx: Ctx; banner: string; onRan: () => void; inject?: { cmd: string; n: number } }) {
  const el = useRef<HTMLDivElement>(null)
  const api = useRef<{ exec: (cmd: string) => void } | null>(null)

  useEffect(() => {
    const term = new XTerm({
      fontFamily: '"JetBrains Mono Variable", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      convertEol: true,
      theme: { background: '#0b0d10', foreground: '#d6dae0', cursor: '#f0a73a', selectionBackground: '#f0a73a55', black: '#0b0d10', brightBlack: '#5b6470', red: '#e5534b', green: '#4cc38a', yellow: '#f0a73a', blue: '#6cb6ff', cyan: '#56d4dd' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el.current!)
    fit.fit()
    // Re-measure cells once the self-hosted mono font has loaded.
    document.fonts.ready.then(() => {
      term.options.fontFamily = '"JetBrains Mono Variable", monospace'
      fit.fit()
    })
    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(el.current!)

    let buf = ''
    let busy = false
    const hist: string[] = []
    let hi = 0
    const redraw = () => term.write(`\r\x1b[2K${prompt(ctx.cwd)}${buf}`)
    const exec = async (cmd: string) => {
      busy = true
      if (cmd.trim()) hist.push(cmd)
      hi = hist.length
      const out = await run(ctx, cmd)
      if (out) term.write(out.endsWith('\n') ? out : out + '\n')
      busy = false
      buf = ''
      term.write(prompt(ctx.cwd))
      onRan()
    }
    api.current = {
      exec: (cmd) => {
        if (busy) return
        term.write(`\r\x1b[2K${prompt(ctx.cwd)}${cmd}\n`)
        exec(cmd)
      },
    }

    term.write(banner + '\n' + prompt(ctx.cwd))
    const sub = term.onData((d) => {
      if (busy) return
      if (d === '\r') {
        term.write('\n')
        exec(buf)
      } else if (d === '\x7f') {
        if (buf) (buf = buf.slice(0, -1)), term.write('\b \b')
      } else if (d === '\t') {
        const r = complete(ctx, buf)
        if (r.options.length) term.write('\n' + r.options.map((o) => C.dim(o)).join('  ') + '\n')
        buf = r.line
        redraw()
      } else if (d === '\x1b[A' || d === '\x1b[B') {
        hi = Math.max(0, Math.min(hist.length, hi + (d === '\x1b[A' ? -1 : 1)))
        buf = hist[hi] ?? ''
        redraw()
      } else if (d === '\x03') {
        buf = ''
        term.write('^C\n' + prompt(ctx.cwd))
      } else if (d === '\x0c') {
        term.clear()
      } else if (!d.startsWith('\x1b')) {
        const clean = d.replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, '')
        buf += clean
        term.write(clean)
      }
    })
    term.focus()
    return () => {
      sub.dispose()
      ro.disconnect()
      term.dispose()
    }
    // ctx identity is stable for a case session
  }, [ctx])

  useEffect(() => {
    if (inject) api.current?.exec(inject.cmd)
  }, [inject])

  return <div ref={el} className="h-full w-full" />
}
