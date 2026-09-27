import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { C, type Ctx, complete, run } from '../term/commands'

const prompt = (cwd: string) => `\x1b[32mexaminer@carve\x1b[0m:\x1b[34m${cwd}\x1b[0m$ `

const HIST_MAX = 500
const BUF_MAX = 4096
/** Things that legitimately own the keyboard, so we must not pull focus off them. */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const CONTROL = 'button, a[href], [role="button"]'

/** `echo` means the line was not already on screen (a GUI injection) and needs the prompt drawn first. */
type Line = { cmd: string; echo: boolean }

/** xterm front-end for the command layer. `ctx` is mutable session state owned by the parent. */
export default function Terminal({ ctx, banner, onRan, inject }: { ctx: Ctx; banner: string; onRan: (cmd: string, out: string) => void; inject?: { cmd: string; n: number } }) {
  const el = useRef<HTMLDivElement>(null)
  const api = useRef<{ exec: (cmd: string) => void } | null>(null)
  // ponytail: banner and onRan get a fresh identity on every parent render; depending on them would
  // tear the terminal down and lose the scrollback, so publish them into a ref and read at use time.
  // Declared before the effect below so it is populated first on mount.
  const live = useRef({ banner, onRan })
  useEffect(() => {
    live.current = { banner, onRan }
  })

  useEffect(() => {
    const node = el.current!
    const term = new XTerm({
      fontFamily: '"JetBrains Mono Variable", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      convertEol: true,
      screenReaderMode: true,
      theme: { background: '#0b0d10', foreground: '#d6dae0', cursor: '#f0a73a', selectionBackground: '#f0a73a55', black: '#0b0d10', brightBlack: '#7c8797', red: '#e5534b', green: '#4cc38a', yellow: '#f0a73a', blue: '#6cb6ff', cyan: '#56d4dd' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(node)
    fit.fit()

    // Set by the cleanup below. Every async continuation checks it before touching xterm.
    let dead = false
    const bail = (e: unknown) => {
      if (!dead) console.error(e)
    }

    // Re-measure cells once the self-hosted mono font has loaded. The promise is uncancellable.
    document.fonts.ready.then(() => {
      if (dead) return
      term.options.fontFamily = '"JetBrains Mono Variable", monospace'
      fit.fit()
    })
    const ro = new ResizeObserver(() => {
      if (!dead) fit.fit()
    })
    ro.observe(node)

    let buf = ''
    let rest = ''
    let busy = false
    let pumping = false
    const hist: string[] = []
    let hi = 0
    const queue: Line[] = []
    // ponytail: a prompt plus buf can soft-wrap, so erase to end of screen; 2K only clears the cursor row.
    const redraw = () => term.write(`\r\x1b[J${prompt(ctx.cwd)}${buf}`)

    const exec = async (cmd: string) => {
      busy = true
      buf = ''
      if (cmd.trim()) {
        hist.push(cmd)
        if (hist.length > HIST_MAX) hist.shift()
      }
      hi = hist.length
      let out = ''
      try {
        out = await run(ctx, cmd)
      } catch (e) {
        out = C.red(`failed: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (dead) return
      if (out) term.write(out.endsWith('\n') ? out : out + '\n')
      busy = false
      term.write(prompt(ctx.cwd))
      live.current.onRan(cmd, out)
    }

    // ponytail: every command goes through one queue drained by a single pump, so a paste or a GUI
    // click that lands mid-command waits its turn instead of interleaving or being dropped. `echo`
    // lines need the prompt drawn, because nothing typed them onto the current line.
    const pump = async () => {
      if (pumping || dead) return
      pumping = true
      try {
        while (queue.length && !dead) {
          const { cmd, echo } = queue.shift()!
          term.write(echo ? `\r\x1b[J${prompt(ctx.cwd)}${cmd}\n` : cmd + '\n')
          await exec(cmd)
        }
        if (!dead && rest) {
          term.write(rest)
          buf = rest
          rest = ''
        }
      } finally {
        pumping = false
      }
    }
    api.current = {
      exec: (cmd) => {
        if (dead) return
        queue.push({ cmd, echo: true })
        pump().catch(bail)
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
    node.addEventListener('contextmenu', onContext)

    term.write(live.current.banner + '\n' + prompt(ctx.cwd))
    const sub = term.onData((d) => {
      const multi = d.length > 1 && /[\r\n]/.test(d)
      if (busy && !multi) return
      if (multi) {
        const lines = (buf + d.replace(/[^\x20-\x7e\r\n]/g, '')).split(/\r\n|\r|\n/)
        rest = lines.pop() ?? ''
        if (rest.length > BUF_MAX) rest = rest.slice(0, BUF_MAX) + '…'
        buf = ''
        queue.push(...lines.map((cmd) => ({ cmd, echo: busy })))
        // Mid-command no prompt is on screen yet, so leave the output alone and let the pump echo.
        if (!busy) term.write(`\r\x1b[J${prompt(ctx.cwd)}`)
        pump().catch(bail)
      } else if (d === '\r') {
        term.write('\n')
        queue.push({ cmd: buf, echo: false })
        pump().catch(bail)
      } else if (d === '\x7f') {
        if (buf) {
          buf = buf.slice(0, -1)
          term.write('\b \b')
        }
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
        if (!clean) return
        hi = hist.length
        const add = clean.slice(0, Math.max(0, BUF_MAX - buf.length))
        if (add) {
          buf += add
          term.write(add)
        }
        if (add.length < clean.length) term.write(C.dim('…'))
      }
    })

    // ponytail: xterm types through a hidden textarea, so any GUI click parks focus and typing dies.
    // Take it back, except inside a field or on a key a focused control still needs (Space, Enter).
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (!(t instanceof Element) || t.closest(TYPING)) return
      if (t.closest(CONTROL) && (e.key === ' ' || e.key === 'Enter' || e.ctrlKey || e.metaKey || e.altKey)) return
      term.focus()
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target
      if (t instanceof Element && t.closest(`${TYPING}, ${CONTROL}`)) return
      term.focus()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)

    term.focus()
    return () => {
      dead = true
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      sub.dispose()
      ro.disconnect()
      node.removeEventListener('contextmenu', onContext)
      term.dispose()
    }
    // ctx identity is stable for a case session
  }, [ctx])

  useEffect(() => {
    if (inject) api.current?.exec(inject.cmd)
  }, [inject])

  return <div ref={el} role="log" aria-label="Terminal output" aria-live="polite" className="h-full w-full" />
}
