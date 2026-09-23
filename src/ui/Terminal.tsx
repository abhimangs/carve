import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { C, type Ctx, complete, run } from '../term/commands'

const prompt = (cwd: string) => `\x1b[32mexaminer@carve\x1b[0m:\x1b[34m${cwd}\x1b[0m$ `

/** xterm front-end for the command layer. `ctx` is mutable session state owned by the parent. */
export default function Terminal({ ctx, banner, onRan, inject }: { ctx: Ctx; banner: string; onRan: (cmd: string, out: string) => void; inject?: { cmd: string; n: number } }) {
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
      onRan(cmd, out)
    }
    api.current = {
      exec: (cmd) => {
        if (busy) return
        term.write(`\r\x1b[2K${prompt(ctx.cwd)}${cmd}\n`)
        exec(cmd)
      },
    }

    // Copy/paste like a desktop terminal. Ctrl+Shift+C would otherwise open the browser's inspector.
    const copy = () => {
      const sel = term.getSelection()
      if (sel) navigator.clipboard?.writeText(sel).catch(() => {})
      term.clearSelection()
    }
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey)) return true
      const k = e.key.toLowerCase()
      if (k === 'c' && (e.shiftKey || term.hasSelection())) {
        e.preventDefault()
        copy()
        return false
      }
      // Let the browser fire its native paste event; xterm turns it into onData.
      if (k === 'v') return false
      return true
    })
    const onContext = (e: MouseEvent) => {
      if (!term.hasSelection()) return
      e.preventDefault()
      copy()
    }
    el.current!.addEventListener('contextmenu', onContext)

    // Pasting several lines runs them one after another.
    const queue: string[] = []
    let rest = ''
    const pump = async () => {
      while (queue.length) {
        const line = queue.shift()!
        term.write(line + '\n')
        await exec(line)
      }
      if (rest) (buf = rest), term.write(rest), (rest = '')
    }

    term.write(banner + '\n' + prompt(ctx.cwd))
    const sub = term.onData((d) => {
      if (busy) return
      if (d.length > 1 && /[\r\n]/.test(d)) {
        const lines = (buf + d.replace(/[^\x20-\x7e\r\n]/g, '')).split(/\r\n|\r|\n/)
        rest = lines.pop() ?? ''
        buf = ''
        term.write(`\r\x1b[2K${prompt(ctx.cwd)}`)
        queue.push(...lines)
        pump()
      } else if (d === '\r') {
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
        const clean = d.replace(/[^\x20-\x7e]/g, '')
        buf += clean
        term.write(clean)
      }
    })
    term.focus()
    return () => {
      sub.dispose()
      ro.disconnect()
      el.current?.removeEventListener('contextmenu', onContext)
      term.dispose()
    }
    // ctx identity is stable for a case session
  }, [ctx])

  useEffect(() => {
    if (inject) api.current?.exec(inject.cmd)
  }, [inject])

  return <div ref={el} className="h-full w-full" />
}
