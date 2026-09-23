import { b64, concat, ep } from '../fs/bytes'
import { docx, jpegWithExif, pdf, zip } from '../fs/formats'
import { photoJpg, receiptJpg } from '../fs/fixtures'
import type { Case } from './index'

const H = '/home/kvance'

const history = `cd ~
${ep('2025-04-02T18:22:40Z')}
python3 ~/bin/ts.py Documents/Invoices/invoice_HS-2231.docx "2025-01-10 09:04:00"
${ep('2025-04-02T19:12:30Z')}
zip vault.zip bank_details.txt vendor_setup.txt
${ep('2025-04-02T19:12:41Z')}
cat IMG_0007.jpg vault.zip > Pictures/receipt.jpg
${ep('2025-04-02T19:13:02Z')}
shred -u bank_details.txt vendor_setup.txt vault.zip IMG_0007.jpg
${ep('2025-04-02T19:20:05Z')}
rm Downloads/audit_notice.pdf Pictures/IMG_2291.jpg
`

const vault = zip([
  { name: 'bank_details.txt', mtime: '2025-04-02 20:12:25', data: 'Beneficiary: K. Vance LLC (Delaware)\nBank: Meridian Trust\nIBAN: GB33MRDN40051512345678\nSWIFT: MRDNGB2L\n' },
  { name: 'vendor_setup.txt', mtime: '2025-04-02 20:12:28', data: 'Vendor master update - Harbor Supply Co.\nRemit-to changed: Harbor Supply Co. -> K. Vance LLC\nApprover (forged): R. Okafor\n' },
])

const invoice = (no: string, amount: string, payee: string) => [
  'HARBOR SUPPLY CO.',
  `Invoice ${no}`,
  `Consulting services: ${amount}`,
  `Remit to: ${payee}`,
  'Terms: Net 30',
]

export const fraud: Case = {
  id: 'fraud',
  title: 'Backdated',
  difficulty: 'Hard',
  label: 'HFA-LT-0388',
  brief: [
    'Harbor Supply Co. says it never issued invoice HS-2231 for $48,500. Accounts payable manager Kyle Vance paid it anyway, and the money went to "K. Vance LLC".',
    'Vance says the invoice was approved routinely in January. He also says that on 2 April 2025 he left the London office at 17:00 and spent the evening at home.',
    'Internal Audit sent a notice that day. His laptop was imaged the next morning. Test his story: timestamps can lie.',
  ],
  objectives: [
    'Find evidence of forged timestamps, and establish when the invoice was really created.',
    'Recover proof of where Vance was that evening and where the money went.',
    'Watch out for timezones: London was on BST (UTC+1).',
  ],
  ops: [
    { op: 'mkdir', path: '/home', t: '2024-09-01T08:00:00Z' },
    { op: 'mkdir', path: H, t: '2024-09-01T08:00:00Z' },
    { op: 'mkdir', path: `${H}/Documents`, t: '2024-09-01T08:00:00Z' },
    { op: 'mkdir', path: `${H}/Documents/Invoices`, t: '2024-09-01T08:00:00Z' },
    { op: 'mkdir', path: `${H}/Downloads`, t: '2024-09-01T08:00:00Z' },
    { op: 'mkdir', path: `${H}/Pictures`, t: '2024-09-01T08:00:00Z' },
    { op: 'mkdir', path: `${H}/bin`, t: '2024-09-01T08:00:00Z' },
    { op: 'write', path: `${H}/.profile`, t: '2024-09-01T08:00:00Z', data: '# ~/.profile\nexport HISTTIMEFORMAT="%F %T "\nexport TZ=Europe/London\n' },
    { op: 'write', path: `${H}/Documents/Invoices/invoice_HS-2198.docx`, t: '2025-01-10T08:52:00Z', data: docx(invoice('HS-2198', '$6,200', 'Harbor Supply Co.'), { creator: 'Harbor Supply AR', lastModifiedBy: 'Harbor Supply AR', revision: 1, created: '2025-01-09T15:30:00Z', modified: '2025-01-09T15:30:00Z', title: 'Invoice HS-2198' }, '2025-01-09 15:30:00') },
    { op: 'write', path: `${H}/Downloads/budget_draft.pdf`, t: '2025-03-20T11:00:00Z', data: pdf(['Q2 budget draft - AP team', 'Headcount: 4', 'Software: $12,000']) },
    { op: 'delete', path: `${H}/Downloads/budget_draft.pdf`, t: '2025-03-28T16:10:00Z' },
    { op: 'write', path: `${H}/Pictures/IMG_2290.jpg`, t: '2025-03-29T13:15:00Z', data: jpegWithExif(photoJpg, { make: 'Apple', model: 'iPhone 14', dateTimeOriginal: '2025:03:29 13:02:51', offsetTimeOriginal: '+00:00', gps: { lat: 51.5145, lon: -0.1406, utc: '2025:03:29 13:02:51' } }) },
    { op: 'write', path: `${H}/bin/ts.py`, t: '2025-03-30T21:40:00Z', data: '#!/usr/bin/env python3\n# ts.py <file> "<YYYY-mm-dd HH:MM:SS>"  - set atime/mtime/birth\nimport os, sys, time\nt = time.mktime(time.strptime(sys.argv[2], "%Y-%m-%d %H:%M:%S"))\nos.utime(sys.argv[1], (t, t))\nsetbirth(sys.argv[1], t)\n' },
    { op: 'write', path: `${H}/.bash_history`, t: '2025-04-01T17:00:00Z', data: 'ls\ncd Documents\n' },
    { op: 'write', path: `${H}/Downloads/audit_notice.pdf`, t: '2025-04-02T17:40:00Z', data: pdf(['From: Internal Audit <audit@harlowfinch.example>', 'Sent: 2025-04-02 17:38 UTC', 'To: Accounts Payable', 'Subject: Vendor payment audit - starts 3 April', '', 'All invoices paid since 1 January will be sampled.', 'Do not delete or modify any records.']) },
    { op: 'write', path: `${H}/Documents/Invoices/invoice_HS-2231.docx`, t: '2025-04-02T18:05:00Z', data: docx(invoice('HS-2231', '$48,500', 'K. Vance LLC'), { creator: 'Kyle Vance', lastModifiedBy: 'Kyle Vance', revision: 3, created: '2025-04-02T18:04:30Z', modified: '2025-04-02T18:20:00Z', title: 'Invoice HS-2231' }, '2025-04-02 19:20:00') },
    { op: 'stomp', path: `${H}/Documents/Invoices/invoice_HS-2231.docx`, t: '2025-04-02T18:22:40Z', set: { b: '2025-01-10T09:04:00Z', m: '2025-01-10T09:04:00Z', a: '2025-01-10T09:04:00Z' } },
    { op: 'write', path: `${H}/Pictures/IMG_2291.jpg`, t: '2025-04-02T18:52:00Z', data: jpegWithExif(photoJpg, { make: 'Apple', model: 'iPhone 14', dateTimeOriginal: '2025:04:02 19:48:10', offsetTimeOriginal: '+01:00', gps: { lat: 51.5054, lon: -0.0235, utc: '2025:04:02 18:48:10' } }) },
    { op: 'write', path: `${H}/Pictures/receipt.jpg`, t: '2025-04-02T19:12:41Z', data: concat(b64(receiptJpg), vault) },
    { op: 'write', path: `${H}/.bash_history`, t: '2025-04-02T19:20:10Z', data: history, as: 'old-history' },
    { op: 'wipe', path: `${H}/Downloads/audit_notice.pdf`, t: '2025-04-02T19:20:05Z' },
    { op: 'delete', path: `${H}/Pictures/IMG_2291.jpg`, t: '2025-04-02T19:20:05Z' },
    { op: 'delete', path: `${H}/.bash_history`, t: '2025-04-02T19:25:00Z' },
    { op: 'write', path: `${H}/.bash_history`, t: '2025-04-02T19:25:30Z', data: 'ls\nexit\n' },
  ],
  evidence: [
    { id: 'audit', label: 'audit_notice.pdf (carved)', find: { carve: `${H}/Downloads/audit_notice.pdf` }, event: 'Internal Audit emails the vendor-payment audit notice', t: '2025-04-02T17:38:00Z', timeSource: 'The inode was wiped, so carve the PDF and read "Sent: ... 17:38 UTC" with strings', why: 'The trigger: everything that follows is a reaction to the audit.' },
    { id: 'invoice', label: 'invoice_HS-2231.docx (timestomped)', find: { path: `${H}/Documents/Invoices/invoice_HS-2231.docx` }, event: 'Fake invoice HS-2231 actually created (payee: K. Vance LLC)', t: '2025-04-02T18:05:00Z', timeSource: 'The $FN birth time in istat, or docx core.xml "created" (18:04:30). The $SI times say January because they were forged', why: 'Timestomping: $SI birth time is earlier than $FN birth time, which cannot happen naturally.' },
    { id: 'history', label: '.bash_history (deleted original)', find: { path: 'old-history' }, event: 'Runs ts.py to backdate the invoice to January', t: '2025-04-02T18:22:40Z', timeSource: 'The #epoch line above the ts.py command', why: 'His own command history shows the forgery, the stego trick and the deletions.' },
    { id: 'photo', label: 'IMG_2291.jpg (deleted)', find: { path: `${H}/Pictures/IMG_2291.jpg` }, event: 'Photo taken in the office car park (GPS 51.5054, -0.0235)', t: '2025-04-02T18:48:10Z', timeSource: 'GPSDateTime, which is always UTC. DateTimeOriginal 19:48:10 is BST local time (+01:00): off by one hour', why: 'Breaks the alibi: he was at the office after 17:00.' },
    { id: 'vault', label: 'vault.zip hidden in receipt.jpg', find: { embedded: `${H}/Pictures/receipt.jpg` }, event: 'Hides shell-company bank details inside receipt.jpg', t: '2025-04-02T19:12:30Z', timeSource: 'The #epoch of the zip command. Entry times inside the zip are local BST (20:12, so 19:12 UTC)', why: 'Links the payment to his own shell company. Data after a JPEG\'s FFD9 end marker is ignored by image viewers.' },
  ],
  decoys: [
    { label: 'invoice_HS-2198.docx', find: { path: `${H}/Documents/Invoices/invoice_HS-2198.docx` }, why: 'A genuine January invoice: $SI and $FN times agree and the author is Harbor Supply.' },
    { label: 'IMG_2290.jpg', find: { path: `${H}/Pictures/IMG_2290.jpg` }, why: 'A lunch photo from 29 March in Soho, unrelated.' },
    { label: 'budget_draft.pdf (deleted)', find: { path: `${H}/Downloads/budget_draft.pdf` }, why: 'Deleted a week before the audit notice. A routine cleanup.' },
  ],
  hints: [
    '`istat` on each invoice. Compare the $SI birth time with the $FN birth time. If $SI is earlier, it was forged.',
    'For a docx, `exif` also reads its internal core.xml metadata: who created it and when.',
    'The audit notice PDF has no inode left. `carve` unallocated space, then `strings` the result.',
    'Photo times: DateTimeOriginal is local time. GPSDateTime is UTC. London is UTC+1 in April.',
    'receipt.jpg is bigger than a 200x140 image should be. `carve receipt.jpg` looks for files hidden inside it.',
  ],
}
