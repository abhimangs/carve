/**
 * Client-safe case manifest: everything the browser is allowed to see.
 *
 * The answer key (ops, evidence times, decoys, hints) lives in the case scripts
 * and is never imported by the client, which only reads this file plus the
 * prebuilt image in public/cases/<id>.img. This module must stay pure data: it
 * must not import ./index, the case files or anything from ../fs.
 */
export type CaseMeta = {
  id: string
  title: string
  difficulty: 'Easy' | 'Medium' | 'Hard'
  label: string // volume label
  brief: string[]
  objectives: string[]
  /** Short skill tags shown on the home page. Indexed with the case itself so a new case cannot break the list. */
  skill: string[]
}

export const CASE_META: CaseMeta[] = [
  {
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
    skill: ['Listing deleted entries', 'Inode recovery', 'Shell-history epochs'],
  },
  {
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
    skill: ['Partial overwrites', 'Signature carving', 'Deletion (C) times'],
  },
  {
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
    skill: ['Timestomp detection', 'EXIF GPS and timezones', 'Data hidden after EOI'],
  },
]
