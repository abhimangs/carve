// bun test: the whole trainee-facing surface of run() and complete(), over real case images.
import { describe, expect, test } from 'bun:test'
import { CASES, loadCase, type Loaded } from '../cases'
import { C, RECOVERED, complete, run, type Ctx, type Target } from './commands'

const caseById = (id: string): Loaded => {
  const c = CASES.find((x) => x.id === id)
  if (!c) throw new Error(`commands: CASES has no case "${id}"; it has ${CASES.map((x) => x.id).join(', ')}`)
  const hit = LOADED[c.id]
  if (!hit) throw new Error(`commands: case "${id}" was not loaded`)
  return hit
}

const LOADED: Record<string, Loaded> = {}
for (const c of CASES) LOADED[c.id] = await loadCase(c)

/** Every command run() accepts. whoami is accepted but absent from HELP, which is asserted below. */
const ACCEPTED = ['ls', 'cd', 'pwd', 'cat', 'file', 'fls', 'istat', 'icat', 'blkls', 'carve', 'hexdump', 'strings', 'grep', 'exif', 'unzip', 'sha256sum', 'date', 'tag', 'open', 'clear', 'help', 'whoami']

type Spy = { deleted: number; recovered: number; board: Map<string, string>; tagged: { target: Target; sha: string }[]; opened: Target[] }

function harness(l: Loaded, cwd = '/'): { ctx: Ctx; spy: Spy } {
  const spy: Spy = { deleted: 0, recovered: 0, board: new Map(), tagged: [], opened: [] }
  return {
    spy,
    ctx: {
      disk: l.disk,
      cwd,
      recovered: new Map(),
      onFlsDeleted: () => spy.deleted++,
      // Mirrors Workspace's onTag, including the duplicate-SHA guard the command layer leans on.
      onTag: (t, sha) => {
        if (spy.board.has(sha)) return C.amber('Already on the evidence board (same SHA-256).')
        spy.board.set(sha, t.path)
        spy.tagged.push({ target: t, sha })
        return C.green(`Tagged ${t.path}\nsha256 ${sha}\n`) + C.dim('Placed on the evidence timeline.')
      },
      onOpen: (t) => spy.opened.push(t),
      onRecovered: () => spy.recovered++,
    },
  }
}

/** The inode a case file ended up on, found by name so the numbers never have to be hardcoded. */
const ino = (id: string, name: string, deleted = false) => {
  const n = caseById(id).disk.inodes().find((x) => x.name === name && x.deleted === deleted)
  if (!n) throw new Error(`commands: ${id} has no ${deleted ? 'deleted ' : ''}inode named ${name}`)
  return n.ino
}

describe('help, whoami, clear', () => {
  test('help lists every command run accepts', async () => {
    const { ctx } = harness(caseById('insider'))
    const out = await run(ctx, 'help')
    for (const c of ACCEPTED.filter((x) => x !== 'help')) expect(out).toContain(c)
    expect(out).toContain(C.dim('Tab completes, ↑/↓ history. Recovered files live in /recovered.'))
  })

  test('whoami answers examiner and is not in the tab-completion list', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'whoami')).toBe('examiner')
    expect(complete(ctx, 'who').options).toEqual([])
  })


  test('clear returns the ANSI erase-and-home sequence', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'clear')).toBe('\x1b[2J\x1b[H')
  })

  test('an empty line produces no output', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, '')).toBe('')
    expect(await run(ctx, '   ')).toBe('')
  })
})

describe('pwd and cd', () => {
  test('pwd follows cd, including .. traversal and an absolute reset', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'pwd')).toBe('/')
    expect(await run(ctx, 'cd /home/dreyes')).toBe('')
    expect(await run(ctx, 'pwd')).toBe('/home/dreyes')
    expect(await run(ctx, 'cd Documents')).toBe('')
    expect(await run(ctx, 'pwd')).toBe('/home/dreyes/Documents')
    expect(await run(ctx, 'cd ..')).toBe('')
    expect(await run(ctx, 'pwd')).toBe('/home/dreyes')
    expect(await run(ctx, 'cd /home/dreyes/Documents/../Downloads')).toBe('')
    expect(await run(ctx, 'pwd')).toBe('/home/dreyes/Downloads')
    expect(await run(ctx, 'cd')).toBe('')
    expect(await run(ctx, 'pwd')).toBe('/')
  })

  test('an unknown path is an error, and so is a file', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'cd /nope')).toBe('cd: /nope: No such directory')
    expect(await run(ctx, 'cd /home/dreyes/Documents/meeting_notes.txt')).toBe('cd: /home/dreyes/Documents/meeting_notes.txt: No such directory')
    expect(ctx.cwd).toBe('/')
  })

  test('/recovered is a real cwd even though it is not in the image', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, `cd ${RECOVERED}`)).toBe('')
    expect(await run(ctx, 'pwd')).toBe(RECOVERED)
  })
})

describe('ls', () => {
  test('a directory lists its entries, with directories marked', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'ls /home/dreyes')).toBe(
      `${C.blue('Documents/')}  ${C.blue('Downloads/')}  ${C.blue('Pictures/')}`,
    )
    expect(await run(ctx, 'ls /')).toBe(`${C.blue('home/')}  ${C.blue('tmp/')}  ${C.blue('recovered/')}`)
  })

  test('-a reveals hidden entries, plain ls does not', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'ls /tmp')).toBe('') // .X0-lock is hidden, so the listing is empty
    expect(await run(ctx, 'ls -a /tmp')).toBe(C.dim('.X0-lock'))
    expect(await run(ctx, 'ls /home/dreyes')).not.toContain('.bashrc')
    expect(await run(ctx, 'ls -a /home/dreyes')).toContain(C.dim('.bashrc'))
  })

  test('-l prints mode, inode, size and mtime', async () => {
    const { ctx } = harness(caseById('insider'))
    const out = await run(ctx, 'ls -l /')
    expect(out.split('\n')[0]).toBe(`drw-r--r--    2      12  2024-11-04 08:00  ${C.blue('home/')}`)
    expect(out.split('\n')[0]).toMatch(/^drw-r--r--\s+\d+\s+\d+\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    expect(out).toContain(`drw-r--r--    -      16  2024-11-04 08:00  ${C.blue('recovered/')}`) // the overlay has no inode
  })

  test('a file argument prints its resolved path', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'ls /home/dreyes/Documents/meeting_notes.txt')).toBe('/home/dreyes/Documents/meeting_notes.txt')
  })

  test('a missing path is an error', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'ls /nope')).toBe('ls: /nope: No such file or directory')
  })

  test('a numeric inode is reported as a path and points at icat/istat, like cat already did', async () => {
    const { ctx } = harness(caseById('insider'))
    const n = ino('insider', '.bash_history', true)
    expect(await run(ctx, `ls ${n}`)).toBe(`ls: /${n}: No such file or directory${C.dim(' (for inode numbers use icat/istat)')}`)
  })


  test('/recovered starts empty and lists what has been recovered', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'ls /recovered')).toBe(C.dim('(empty: use icat or carve to recover files here)'))
    const n = ino('insider', '.bash_history', true)
    await run(ctx, `icat ${n}`)
    expect(await run(ctx, 'ls /recovered')).toBe(C.green(`${n}_.bash_history`))
    expect(await run(ctx, 'ls -l /recovered')).toContain(`icat inode ${n} (/home/dreyes/.bash_history)`)
  })
})

describe('cat and target()', () => {
  test('cat prints text and drops the trailing newline', async () => {
    const { ctx } = harness(caseById('insider'))
    const out = await run(ctx, 'cat /home/dreyes/Documents/meeting_notes.txt')
    expect(out).toBe('Weekly pipeline sync\n- Castellan renewal on track\n- Everly wants dashboards add-on quote\n- Offsite planning: vote by Friday')
  })

  test('.. segments and a relative path resolve against cwd', async () => {
    const { ctx } = harness(caseById('insider'), '/home/dreyes/Downloads')
    expect(await run(ctx, 'cat ../Documents/meeting_notes.txt')).toContain('Weekly pipeline sync')
    expect(await run(ctx, 'cat /home/dreyes/Downloads/../Documents/pricing_2025.csv')).toContain('NW-AN-ENT')
    expect(await run(ctx, 'cat ../Documents/grocery.txt')).toBe(C.red('cat: ../Documents/grocery.txt: No such file or directory')) // deleted
    expect(ctx.cwd).toBe('/home/dreyes/Downloads')
  })

  test('a directory is refused with "Is a directory"', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'cat /home')).toBe(C.red('cat: /home: Is a directory'))
  })

  test('a numeric argument gets the icat/istat hint', async () => {
    const { ctx } = harness(caseById('insider'))
    const n = ino('insider', '.bash_history', true)
    expect(await run(ctx, `cat ${n}`)).toBe(C.red(`cat: ${n}: No such file or directory (for inode numbers use icat/istat)`))
  })

  test('a missing operand and a missing file are both errors', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'cat')).toBe(C.red('cat: missing file operand'))
    expect(await run(ctx, 'cat /nope')).toBe(C.red('cat: /nope: No such file or directory'))
  })

  test('a recovered file is readable under /recovered', async () => {
    const { ctx } = harness(caseById('insider'))
    const n = ino('insider', '.bash_history', true)
    await run(ctx, `icat ${n}`)
    expect(await run(ctx, `cat ${RECOVERED}/${n}_.bash_history`)).toContain('dropshare.io')
    expect(await run(ctx, 'cat /recovered/nope')).toBe(C.red('cat: /recovered/nope: No such file'))
  })

  test('a binary file is refused with the alternative tools named', async () => {
    const { ctx } = harness(caseById('insider'))
    const out = await run(ctx, 'cat /home/dreyes/Pictures/offsite_2024.jpg')
    expect(out).toBe(C.amber('cat: /home/dreyes/Pictures/offsite_2024.jpg is binary (JPEG image data, Exif standard). Try strings, hexdump, exif or unzip -l.'))
  })
})

describe('fls', () => {
  test('fls -r -d / lists only deleted entries, with inode numbers, and fires onFlsDeleted', async () => {
    const { ctx, spy } = harness(caseById('insider'))
    const out = await run(ctx, 'fls -r -d /')
    expect(out).not.toContain('meeting_notes.txt')
    expect(out.split('\n')).toEqual([
      `r/r ${C.red('*')} ${String(ino('insider', 'grocery.txt', true)).padStart(2)}:\t${C.red('/home/dreyes/Documents/grocery.txt')}`,
      `r/r ${C.red('*')} ${String(ino('insider', 'Crestline_Offer.pdf', true)).padStart(2)}:\t${C.red('/home/dreyes/Downloads/Crestline_Offer.pdf')}`,
      `r/r ${C.red('*')} ${String(ino('insider', 'Screenshot_2025-03-13_23-04-40.jpg', true)).padStart(2)}:\t${C.red('/home/dreyes/Pictures/Screenshot_2025-03-13_23-04-40.jpg')}`,
      `r/r ${C.red('*')} ${String(ino('insider', '.bash_history', true)).padStart(2)}:\t${C.red('/home/dreyes/.bash_history')}`,
      `r/r ${C.red('*')} ${String(ino('insider', 'q3_clients.zip', true)).padStart(2)}:\t${C.red('/tmp/q3_clients.zip')}`,
    ])
    expect(spy.deleted).toBe(1)
  })

  test('fls without -d lists live and deleted, marking deleted with *', async () => {
    const { ctx, spy } = harness(caseById('insider'))
    const out = await run(ctx, 'fls -r /')
    expect(out).toContain(`${String(ino('insider', 'clients_q3.csv')).padStart(2)}:\t/home/dreyes/Documents/clients_q3.csv`)
    expect(out).toContain(`${C.blue('/home/dreyes')}`)
    expect(out).toContain(C.red('*'))
    expect(spy.deleted).toBe(1)
  })

  test('onFlsDeleted stays quiet when the subtree holds nothing deleted', async () => {
    const { ctx, spy } = harness(caseById('fraud'))
    const out = await run(ctx, 'fls /home/kvance/bin')
    expect(out).toBe(`r/r ${' '} ${String(ino('fraud', 'ts.py')).padStart(2)}:\t/home/kvance/bin/ts.py`)
    expect(spy.deleted).toBe(0)
  })

  test('fls marks a reallocated deleted file and reports an unknown root', async () => {
    const { ctx } = harness(caseById('ransomware'))
    const n = ino('ransomware', 'auth.log', true)
    expect(await run(ctx, 'fls -r -d /var/log')).toBe(
      `r/r ${C.red('*')} ${String(n).padStart(2)}${C.red('(realloc)')}:\t${C.red('/var/log/auth.log')}\n` +
        `r/r ${C.red('*')} ${String(ino('ransomware', 'dpkg.log.1', true)).padStart(2)}:\t${C.red('/var/log/dpkg.log.1')}`,
    )
    expect(await run(ctx, 'fls /nope')).toBe('fls: /nope: not found')
  })
})

describe('istat', () => {
  test('a normal file prints MACB, $FN and its blocks', async () => {
    const { ctx } = harness(caseById('insider'))
    const n = ino('insider', '.bashrc')
    const node = caseById('insider').disk.inode(n)
    const out = await run(ctx, `istat ${n}`)
    expect(out).toContain(`${C.bold('inode:')} ${n}    ${C.green('Allocated')}`)
    expect(out).toContain(`name ($FN): .bashrc    parent inode: ${node.parent}    path: /home/dreyes/.bashrc`)
    expect(out).toContain(C.bold('$STANDARD_INFORMATION times (user-modifiable):'))
    expect(out).toContain('  Created  (B): 2024-11-04 08:01:00 UTC')
    expect(out).toContain(C.bold('$FILE_NAME times (set by the filesystem):'))
    expect(out).toContain(C.bold('Direct blocks:'))
  })

  test('a timestomped file warns that $SI predates $FN', async () => {
    const { ctx } = harness(caseById('fraud'))
    const out = await run(ctx, `istat ${ino('fraud', 'invoice_HS-2231.docx')}`)
    expect(out).toContain(C.red('⚠ TIMESTOMP INDICATOR: $SI times are earlier than $FN creation. $SI was probably forged.'))
    expect(out).toContain('  Created  (B): 2025-01-10 09:04:00 UTC') // forged $SI
    expect(out).toContain('  Created  (B): 2025-04-02 18:05:00 UTC') // true $FN
  })

  test('a partly overwritten file names the inode that took each block', async () => {
    const { ctx } = harness(caseById('ransomware'))
    const n = ino('ransomware', 'auth.log', true)
    const ow = caseById('ransomware').disk.overwritten(n)
    const out = await run(ctx, `istat ${n}`)
    expect(out).toContain(C.red('Not Allocated (deleted)'))
    expect(out).toContain(C.dim('   ← set when the file was deleted'))
    for (const { block, owner } of ow) expect(out).toContain(C.red(`⚠ block ${block} now belongs to inode ${owner}: content there has been OVERWRITTEN`))
    expect(out.match(/OVERWRITTEN/g)).toHaveLength(ow.length)
  })

  test('a non-inode and an unused inode are both refused', async () => {
    const { ctx } = harness(caseById('insider'))
    // The command name is prefixed once, by the catch block, not twice.
    expect(await run(ctx, 'istat abc')).toBe(C.red('istat: expected an inode number (see fls)'))
    expect(await run(ctx, 'istat 0')).toBe(C.red('istat: expected an inode number (see fls)'))
    expect(await run(ctx, 'istat 64')).toBe(C.red('istat: expected an inode number (see fls)'))
    expect(await run(ctx, 'istat 60')).toBe(C.red('istat: inode 60 is unused'))
  })

})

describe('icat', () => {
  test('recovers into /recovered as <inode>_<name>, fires onRecovered, and the bytes read back', async () => {
    const { ctx, spy } = harness(caseById('insider'))
    const n = ino('insider', '.bash_history', true)
    const out = await run(ctx, `icat ${n}`)
    const name = `${n}_.bash_history`
    const sha = 'd263d895d36753a1bc157f275a52ad2f9373a4f817a00a8be391cdcf22758809'
    expect(out).toContain(C.green(`Recovered 408 bytes from inode ${n} → ${RECOVERED}/${name}`))
    expect(out).toContain(`sha256 ${sha}`)
    expect(out).toContain(C.dim(`Next: file / cat / strings ${RECOVERED}/${name}, then tag it.`))
    expect(spy.recovered).toBe(1)
    expect([...ctx.recovered.keys()]).toEqual([name])
    expect(ctx.recovered.get(name)!.source).toBe(`icat inode ${n} (/home/dreyes/.bash_history)`)
    expect(await run(ctx, `sha256sum ${RECOVERED}/${name}`)).toBe(`${sha}  ${RECOVERED}/${name}`)
    expect(await run(ctx, `file ${RECOVERED}/${name}`)).toBe(`${RECOVERED}/${name}: ASCII text`)
  })

  test('a partly overwritten recovery says so', async () => {
    const { ctx } = harness(caseById('ransomware'))
    const n = ino('ransomware', 'auth.log', true)
    const node = caseById('ransomware').disk.inode(n)
    const out = await run(ctx, `icat ${n}`)
    expect(out).toContain(C.amber(`⚠ ${caseById('ransomware').disk.overwritten(n).length} of ${node.blocks.length} blocks were reallocated: this is a partial recovery.`))
  })

  test('a second argument overrides the recovered name', async () => {
    const { ctx } = harness(caseById('insider'))
    await run(ctx, `icat ${ino('insider', 'grocery.txt', true)} mine.txt`)
    expect([...ctx.recovered.keys()]).toEqual(['mine.txt'])
  })

  test('a directory is refused with a pointer at fls -r -d /', async () => {
    const { ctx } = harness(caseById('insider'))
    const dir = caseById('insider').disk.resolve('/home/dreyes/Downloads')
    expect(await run(ctx, `icat ${dir}`)).toBe(C.amber(`icat: inode ${dir} is a folder, not a file. Run fls -r -d / and use a number from the file list.`))
  })
})

describe('carve', () => {
  test('carve scans unallocated space and files every hit under /recovered', async () => {
    const { ctx, spy } = harness(caseById('insider'))
    const out = await run(ctx, 'carve')
    expect(out).toContain(C.dim('Scanning 472 unallocated blocks for JPEG / PDF / ZIP headers...'))
    expect(out).toContain(C.green(`PDF  block  37     853 B → ${RECOVERED}/carved_0037.pdf`))
    expect(out).toContain(`${RECOVERED}/carved_0043.zip`)
    expect(out).toContain(`${RECOVERED}/carved_0045.jpg`)
    expect(out).toContain(C.dim('Carved files have no filename or timestamps; only their content survives.'))
    expect(spy.recovered).toBe(3)
    expect(ctx.recovered.get('carved_0037.pdf')!.source).toBe('carved from block 37')
  })

  test('carve reaches the ransomware archive whose inode was zeroed', async () => {
    const { ctx } = harness(caseById('ransomware'))
    expect(caseById('ransomware').disk.inodes().some((n) => n.name === 'f.zip')).toBe(false)
    const out = await run(ctx, 'carve')
    expect(out).toContain(`${RECOVERED}/carved_0043.zip`)
    expect(await run(ctx, `unzip -l ${RECOVERED}/carved_0043.zip`)).toContain('manifest.txt')
  })

  test('carve finds the audit notice the fraud image no longer has an inode for', async () => {
    const { ctx } = harness(caseById('fraud'))
    const out = await run(ctx, 'carve')
    expect(out).toContain(`${RECOVERED}/carved_0040.pdf`)
    expect(await run(ctx, `strings -n 8 ${RECOVERED}/carved_0040.pdf`)).toContain('(Sent: 2025-04-02 17:38 UTC)')
    expect(await run(ctx, `strings -n 8 ${RECOVERED}/carved_0031.pdf`)).toContain('Q2 budget draft')
  })

  test('carve <file> pulls the zip hidden after the JPEG end marker', async () => {
    const { ctx, spy } = harness(caseById('fraud'))
    const out = await run(ctx, 'carve /home/kvance/Pictures/receipt.jpg')
    expect(out).toBe(C.green(`Found ZIP at offset 2935 (0xb77), 463 bytes → ${RECOVERED}/receipt.jpg.embedded_0.zip`))
    expect(spy.recovered).toBe(1)
    expect(ctx.recovered.get('receipt.jpg.embedded_0.zip')!.source).toBe('embedded in /home/kvance/Pictures/receipt.jpg @ offset 2935')
    expect(await run(ctx, `unzip -p ${RECOVERED}/receipt.jpg.embedded_0.zip bank_details.txt`)).toContain('K. Vance LLC')
  })

  test('carve <file> says so when there is nothing embedded', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'carve /home/dreyes/Documents/meeting_notes.txt')).toBe(C.dim('No embedded file signatures found.'))
  })
})

describe('strings, grep, hexdump, file, blkls', () => {
  test('strings prints runs of printable bytes, -n sets the minimum length', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'strings /home/dreyes/.bashrc')).toBe('# ~/.bashrc\nexport HISTTIMEFORMAT="%F %T "\nalias ll="ls -la"')
    expect(await run(ctx, 'strings -n 5 /home/dreyes/.bashrc')).toBe('# ~/.bashrc\nexport HISTTIMEFORMAT="%F %T "\nalias ll="ls -la"')
    expect(await run(ctx, 'strings -n 40 /home/dreyes/.bashrc')).toBe('')
    const n = ino('insider', '.bash_history', true)
    await run(ctx, `icat ${n}`)
    expect(await run(ctx, `strings -n 9 ${RECOVERED}/${n}_.bash_history`)).toContain('#1741906990')
  })

  test('grep is case-insensitive, highlights the match and needs two arguments', async () => {
    const { ctx } = harness(caseById('insider'))
    const csv = '/home/dreyes/Documents/clients_q3.csv'
    expect(await run(ctx, `grep renewal ${csv}`)).toBe(`client_id,company,contact,email,annual_value_usd,${C.red('renewal')}`)
    expect(await run(ctx, `grep RENEWAL ${csv}`)).toBe(`client_id,company,contact,email,annual_value_usd,${C.red('renewal')}`)
    expect(await run(ctx, `grep "renewal" ${csv}`)).toContain(C.red('renewal'))
    expect(await run(ctx, `grep Ortiz ${csv}`)).toContain(`C-1003,Castellan Health,M. ${C.red('Ortiz')},m${C.red('ortiz')}@castellan.example`)
    expect(await run(ctx, 'grep Castle /home/dreyes/Documents/clients_q3.csv')).toBe('') // "Castellan" has no "castle" in it
    expect(await run(ctx, 'grep renewal')).toBe('usage: grep <text> <file>')
  })

  test('hexdump -s and -n window the bytes and report what was left out', async () => {
    const { ctx } = harness(caseById('insider'))
    const f = '/home/dreyes/Documents/meeting_notes.txt'
    expect(await run(ctx, `hexdump -n 16 ${f}`)).toBe(
      `${C.dim('00000000')}  57 65 65 6b 6c 79 20 70 69 70 65 6c 69 6e 65 20  ${C.cyan('|Weekly pipeline |')}\n${C.dim('... 108 more bytes (use -n <bytes> or -s <offset>)')}`,
    )
    expect(await run(ctx, `hexdump -s 4 -n 8 ${f}`)).toContain(`${C.dim('00000004')}  6c 79 20 70 69 70 65 6c 69 6e`)
    expect(await run(ctx, `hexdump -n 8 ${f}`)).toContain(C.dim('... 116 more bytes (use -n <bytes> or -s <offset>)'))
  })

  test('hexdump -b reads a raw block and marks it unallocated when it is', async () => {
    const { ctx } = harness(caseById('insider'))
    const out = await run(ctx, 'hexdump -b 42')
    expect(out).toContain(C.dim('block 42 (UNALLOCATED)'))
    expect(out.split('\n')[1]).toContain(C.dim('00005400')) // 42 * 512
    expect(await run(ctx, 'hexdump -b 9999')).toBe('hexdump: bad block')
  })

  test('file sniffs by magic bytes', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'file /home/dreyes/Pictures/offsite_2024.jpg')).toBe('/home/dreyes/Pictures/offsite_2024.jpg: JPEG image data, Exif standard')
    expect(await run(ctx, 'file /home/dreyes/Documents/resignation_letter.docx')).toBe('/home/dreyes/Documents/resignation_letter.docx: Microsoft Word 2007+')
    expect(await run(ctx, 'file /home/dreyes/Documents/meeting_notes.txt')).toBe('/home/dreyes/Documents/meeting_notes.txt: ASCII text')
  })

  test('blkls summarises the data area and the residual blocks', async () => {
    const { ctx } = harness(caseById('insider'))
    const out = await run(ctx, 'blkls')
    expect(out).toContain('Image: 512 blocks × 512 B    data area starts at block 18')
    expect(out).toContain('Unallocated: 472 blocks,')
    expect(out).toContain(C.dim('Blocks with residual data: 32 37 38 42 43 44 45 46 47 48 49 50 51 52'))
  })
})

describe('exif, unzip, sha256sum, date, tag, open', () => {
  test('exif reads a JPEG tag by tag', async () => {
    const { ctx } = harness(caseById('fraud'))
    const n = ino('fraud', 'IMG_2291.jpg', true)
    await run(ctx, `icat ${n}`)
    const out = await run(ctx, `exif ${RECOVERED}/${n}_IMG_2291.jpg`)
    expect(out).toContain(`${C.amber('GPSDateTime (UTC)'.padEnd(22))} 2025:04:02 18:48:10`)
    expect(out).toContain(`${C.amber('OffsetTimeOriginal'.padEnd(22))} +01:00`)
    expect(out).toContain('51.50540, -0.02350')
    expect(await run(ctx, 'exif /home/kvance/bin/ts.py')).toBe(C.dim('No EXIF or Office metadata found.'))
  })

  test('exif falls back to a docx core.xml and then gives up', async () => {
    const { ctx } = harness(caseById('insider'))
    const docx = await run(ctx, 'exif /home/dreyes/Documents/resignation_letter.docx')
    expect(docx).toContain(C.bold('docProps/core.xml'))
    expect(docx).toContain(`${C.amber('created'.padEnd(22))} 2025-03-13T09:15:00Z`)
    expect(docx).toContain(C.bold('Document text'))
    expect(docx).toContain('Dear Priya,')
    expect(await run(ctx, 'exif /home/dreyes/Documents/meeting_notes.txt')).toBe(C.dim('No EXIF or Office metadata found.'))
  })

  test('unzip -l lists entries and -p prints one', async () => {
    const { ctx } = harness(caseById('insider'))
    const f = '/home/dreyes/Documents/resignation_letter.docx'
    const list = await run(ctx, `unzip -l ${f}`)
    expect(list).toContain('  Length  Date       Time      Name')
    expect(list).toContain('    336  2025-03-13 09:31:00  word/document.xml')
    expect(list).toContain(C.dim('Zip times are local wall-clock time with no timezone.'))
    expect(await run(ctx, `unzip -p ${f} docProps/core.xml`)).toContain('<dc:creator>Daniel Reyes</dc:creator>')
    expect(await run(ctx, `unzip -p ${f} nope`)).toBe('unzip: entry nope not found')
    expect(await run(ctx, `unzip -l /home/dreyes/Documents/meeting_notes.txt`)).toBe('unzip: not a zip archive (no end-of-central-directory record)')
  })

  test('sha256sum hashes bytes and echoes the argument as typed', async () => {
    const { ctx } = harness(caseById('insider'))
    const f = '/home/dreyes/Documents/meeting_notes.txt'
    expect(await run(ctx, `sha256sum ${f}`)).toBe(`3c007fb2b57fbda5dd8a804a0568c6968a1be9e229456b75ff9566116690b8cd  ${f}`)
  })

  test('date -d @ converts an epoch to UTC and nothing else is supported', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'date -d @1741906990')).toBe('Thu, 13 Mar 2025 23:03:10 UTC')
    expect(await run(ctx, 'date -d @0')).toBe('Thu, 01 Jan 1970 00:00:00 UTC')
    expect(await run(ctx, 'date')).toBe('usage: date -d @<epoch>')
    expect(await run(ctx, 'date -d @abc')).toBe('date: invalid epoch')
  })

  test('tag puts the sha on the board and reports the duplicate', async () => {
    const { ctx, spy } = harness(caseById('insider'))
    const f = '/home/dreyes/Documents/meeting_notes.txt'
    const n = ino('insider', 'meeting_notes.txt')
    const out = await run(ctx, `tag ${f}`)
    expect(out).toBe(
      C.green(`Tagged ${f}\nsha256 3c007fb2b57fbda5dd8a804a0568c6968a1be9e229456b75ff9566116690b8cd\n`) + C.dim('Placed on the evidence timeline.'),
    )
    expect(spy.tagged).toHaveLength(1)
    expect(spy.tagged[0].target).toMatchObject({ path: f, ino: n, source: `inode ${n}` })
    expect(await run(ctx, `tag ${f}`)).toBe(C.amber('Already on the evidence board (same SHA-256).'))
    expect(spy.tagged).toHaveLength(1)
    expect(await run(ctx, `tag ${n}`)).toBe(C.red(`tag: ${n}: No such file or directory (for inode numbers use icat/istat)`))
  })

  test('open hands the target to the viewer and prints nothing', async () => {
    const { ctx, spy } = harness(caseById('insider'))
    expect(await run(ctx, 'open /home/dreyes/Documents/meeting_notes.txt')).toBe('')
    expect(spy.opened.map((t) => t.path)).toEqual(['/home/dreyes/Documents/meeting_notes.txt'])
  })
})

describe('errors', () => {
  test('an unknown command is red and points at help', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(await run(ctx, 'frobnicate')).toBe(`frobnicate: command not found. Type ${C.amber('help')}`)
  })

  test('every file-taking command reports a missing operand the same way', async () => {
    const { ctx } = harness(caseById('insider'))
    for (const c of ['cat', 'file', 'hexdump', 'strings', 'tag', 'open']) {
      expect(await run(ctx, c)).toBe(C.red(`${c}: missing file operand`))
    }
  })
})

describe('tab completion', () => {
  test('the first word completes over every command in HELP plus help itself', () => {
    const { ctx } = harness(caseById('insider'))
    expect(complete(ctx, '')).toEqual({
      line: '',
      // 'pwd' only appears as the second half of the prose row 'cd <dir> / pwd', and 'whoami' has its own row, so a
      // first-word-only split used to lose both.
      options: ['ls', 'cd', 'pwd', 'cat', 'file', 'fls', 'istat', 'icat', 'blkls', 'carve', 'hexdump', 'strings', 'grep', 'exif', 'unzip', 'sha256sum', 'date', 'tag', 'open', 'clear', 'whoami', 'help'],
    })
  })

  test('a many-way prefix returns the common prefix and the full option list', () => {
    const { ctx } = harness(caseById('insider'))
    expect(complete(ctx, 'he')).toEqual({ line: 'he', options: ['hexdump', 'help'] })
    expect(complete(ctx, 'cat /')).toEqual({ line: 'cat /', options: ['/home/', '/tmp/', '/recovered/'] })
  })

  test('a single match completes the word and adds a space, with no option list', () => {
    const { ctx } = harness(caseById('insider'))
    expect(complete(ctx, 'cat /home/dreyes/Doc')).toEqual({ line: 'cat /home/dreyes/Documents/', options: [] })
    expect(complete(ctx, 'cat /home/dreyes/Documents/meeting')).toEqual({ line: 'cat /home/dreyes/Documents/meeting_notes.txt ', options: [] })
  })

  test('a prefix with no match leaves the line alone', () => {
    const { ctx } = harness(caseById('insider'))
    expect(complete(ctx, 'cat /nope')).toEqual({ line: 'cat /nope', options: [] })
    expect(complete(ctx, 'icat 1')).toEqual({ line: 'icat 1', options: [] })
  })

  test('recovered names complete under /recovered, one match and many', async () => {
    const { ctx } = harness(caseById('insider'))
    expect(complete(ctx, 'cat /recovered/')).toEqual({ line: 'cat /recovered/', options: [] })
    await run(ctx, 'carve')
    expect(complete(ctx, 'cat /recovered/carved_00')).toEqual({
      line: 'cat /recovered/carved_00',
      options: ['/recovered/carved_0037.pdf', '/recovered/carved_0043.zip', '/recovered/carved_0045.jpg'],
    })
    expect(complete(ctx, 'cat /recovered/carved_0043')).toEqual({ line: 'cat /recovered/carved_0043.zip ', options: [] })
  })

  test('completion is relative to cwd', () => {
    const { ctx } = harness(caseById('insider'), '/home/dreyes')
    expect(complete(ctx, 'cd D')).toEqual({ line: 'cd Do', options: ['Documents/', 'Downloads/'] })
    expect(complete(ctx, 'cd Docum')).toEqual({ line: 'cd Documents/', options: [] })
    expect(complete(ctx, 'cd e')).toEqual({ line: 'cd e', options: [] })
  })
})
