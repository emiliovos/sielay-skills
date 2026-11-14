// The instance_id this session shows the hub. Pure (no `$`): the store, the
// clock, the liveness check and the id minting are injected.
//
// The hub hands a session name over to a new instance only after the old one
// has been offline for 60 s, and a second live instance in the same folder
// gets `name-2`. So a reload, `/clear`, `--resume` or restart must come back
// as the SAME instance, while two terminals live at once must stay distinct.
//
// `$.store` (machine-wide) keeps, per (cwd_hash, resolved name), a short list
// of { instance_id, owner, renewed_at }. `owner` names the live Claude Code
// process: its messaging socket path when it has one (the same across reloads
// and /clear, different per terminal), else the session id. A record is this session's when the owner is us; another owner's
// record is taken (its id claimed, its mailboxes adopted) only on positive
// proof that the owner is dead (ownerDead). A lapsed lease alone is no proof:
// it also happens to a live terminal (`/link off` stops renewing, a suspend
// lasts longer than the lease), and taking its id would hand this session the
// hub row, the unread and the held messages of a terminal that still runs.
// A new id is minted while no record is ours or provably dead.
// Two processes claiming at the same instant may race; the next poll settles it.
//
// A `sock:` owner is dead when its process is gone (socketOwnerAlive: the
// socket file outlives its process, so the PID in its name is what tells). A
// `sess:` owner is dead when the `pid` stored in the record no longer runs, or
// is our own pid (a /clear inside the same process). An owner proven alive
// keeps its record however long it goes without renewing. Where liveness
// cannot be told (a record written before `pid` existed, a socket without a
// PID in its name, or a machine without procfs) the record is taken only after
// STALE_NO_PID_MS without renewal (a day: any live terminal that merely paused
// is long back).

import { pidFromSocket } from './link-launch-mode.js'

export const INSTANCE_LEASE_MS = 90_000
export const MAX_RECORDS = 8
export const STALE_NO_PID_MS = 24 * 60 * 60 * 1000
// How long another process's `adopting_by` mark blocks an adoption before it is taken as orphaned.
export const ADOPT_CLAIM_TTL_MS = 60_000

/**
 * @param {string} cwdHash @param {string} name
 * @returns {string}
 */
export function instanceKey(cwdHash, name) {
  return `instance.${cwdHash}.${name}`
}

/**
 * @typedef {{ instance_id: string, owner: string, renewed_at: number, pid?: number, adopting_by?: { by: string, at: number } }} InstanceRecord
 */

/**
 * @param {unknown} v
 * @returns {InstanceRecord[]}
 */
function readRecords(v) {
  if (!Array.isArray(v)) return []
  return v.filter(
    r => r && typeof r === 'object' && typeof r.instance_id === 'string' && r.instance_id !== '' &&
      typeof r.owner === 'string' && typeof r.renewed_at === 'number' && Number.isFinite(r.renewed_at),
  )
}

/**
 * @param {{
 *   store: { get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void> },
 *   key: string,
 *   me: string,
 *   now: number,
 *   ownerAlive: (owner: string) => Promise<boolean|undefined>,
 *   newId: () => string,
 *   pid?: number,
 *   pidAlive?: (pid: number) => Promise<boolean|undefined>,
 * }} input
 * @returns {Promise<string>}
 */
export async function claimInstanceId({ store, key, me, now, ownerAlive, newId, pid, pidAlive = async () => undefined }) {
  const records = readRecords(await store.get(key))

  /** @type {InstanceRecord|undefined} */
  let mine = records.find(r => r.owner === me)
  if (!mine) {
    for (const r of [...records].sort((a, b) => b.renewed_at - a.renewed_at)) {
      if (await ownerDead(r, now, ownerAlive, pid, pidAlive)) {
        mine = r
        break
      }
    }
  }
  if (!mine) {
    mine = { instance_id: newId(), owner: me, renewed_at: now }
    records.push(mine)
  }
  mine.owner = me
  mine.renewed_at = now
  delete mine.adopting_by
  if (typeof pid === 'number') mine.pid = pid
  else delete mine.pid

  const kept = records
    .sort((a, b) => b.renewed_at - a.renewed_at)
    .slice(0, MAX_RECORDS)
  await store.set(key, kept)
  return mine.instance_id
}

/**
 * Whether the Claude Code process behind a messaging socket still runs: true,
 * false, or undefined when it cannot be told. The socket is named `<PID>.sock`
 * and its file stays on disk after the process exits, so on a machine with
 * procfs the PID decides. Without procfs `psAlive` asks `ps` about it. With a
 * socket named otherwise, or neither source answering, a file in place proves
 * nothing either way.
 * @param {string} path the socket path
 * @param {(path: string) => Promise<boolean>} exists
 * @param {(pid: string) => Promise<boolean|undefined>} [psAlive]
 * @returns {Promise<boolean|undefined>}
 */
export async function socketOwnerAlive(path, exists, psAlive) {
  if (!(await exists(path))) return false
  const pid = /(?:^|[\\/])([1-9][0-9]{0,9})\.sock$/.exec(path)?.[1]
  if (!pid) return undefined
  return pidAliveOnHost(pid, exists, psAlive)
}

/**
 * Whether process `pid` runs: its /proc entry where procfs exists, else what
 * `psAlive` says, else undefined (cannot be told).
 * @param {string} pid @param {(path: string) => Promise<boolean>} exists
 * @param {(pid: string) => Promise<boolean|undefined>} [psAlive]
 * @returns {Promise<boolean|undefined>}
 */
export async function pidAliveOnHost(pid, exists, psAlive) {
  let procfs = false
  try {
    procfs = await exists('/proc/self')
    if (procfs) return await exists(`/proc/${pid}`)
  } catch {
    // procfs not readable here
  }
  if (!psAlive) return undefined
  try {
    return await psAlive(pid)
  } catch {
    return undefined
  }
}

/**
 * Positive proof that the record's owner is gone (see the header).
 * @param {InstanceRecord} r @param {number} now
 * @param {(owner: string) => Promise<boolean|undefined>} ownerAlive
 * @param {number|undefined} myPid @param {(pid: number) => Promise<boolean|undefined>} pidAlive
 */
/** @returns {Promise<boolean>} */
async function ownerDead(r, now, ownerAlive, myPid, pidAlive) {
  /** @type {boolean|undefined} */
  let alive
  if (r.owner.startsWith('sock:')) alive = await ownerAlive(r.owner)
  else if (typeof r.pid === 'number') alive = r.pid === myPid ? false : await pidAlive(r.pid)
  if (alive === false) return true
  // proven alive keeps its record however long it stays silent; unknown waits out the day
  if (alive === true) return false
  return now - r.renewed_at > STALE_NO_PID_MS
}

/**
 * What a dead instance left in `held.<id>` and `inbox.<id>` goes to the live one.
 * A restart, or a crash followed by a new terminal, leaves a record whose owner
 * is gone; when the claim mints a new id instead of taking it, the old one's
 * mailboxes would be unreachable. Once an OTHER record of the same key is
 * provably dead (ownerDead), `adopt(from, to)` moves its mailboxes and the
 * record leaves the list. A record whose move fails stays for the next poll and
 * the error is thrown after the others were tried. Never touches another key,
 * nor a record whose owner may be alive, renewing or not.
 *
 * The store has no compare-and-set, so two processes are kept apart in two
 * phases: write `adopting_by` on the record, wait `settle`, read again, and
 * move only if the mark is still ours (a fresh mark of another process makes
 * this one skip). It narrows the race a lot; it cannot close it entirely.
 * @param {{
 *   store: { get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void> },
 *   key: string, mine: string, now: number,
 *   ownerAlive: (owner: string) => Promise<boolean|undefined>,
 *   adopt: (fromId: string, toId: string) => Promise<void>,
 *   pid?: number,
 *   pidAlive?: (pid: number) => Promise<boolean|undefined>,
 *   settle?: () => Promise<void>,
 * }} input
 * @returns {Promise<string[]>} the instance ids adopted
 */
export async function adoptOrphans({ store, key, mine, now, ownerAlive, adopt, pid, pidAlive = async () => undefined, settle = async () => {} }) {
  const adopted = []
  /** @type {unknown} */
  let failure
  for (const seen of readRecords(await store.get(key))) {
    if (seen.instance_id === mine || !(await ownerDead(seen, now, ownerAlive, pid, pidAlive))) continue
    const id = seen.instance_id
    // phase 1: mark the record, unless another process marked it a moment ago
    const first = readRecords(await store.get(key))
    const target = first.find(r => r.instance_id === id)
    if (!target) continue
    if (target.adopting_by && target.adopting_by.by !== mine && now - target.adopting_by.at < ADOPT_CLAIM_TTL_MS) continue
    target.adopting_by = { by: mine, at: now }
    await store.set(key, first)
    await settle()
    // phase 2: still ours?
    if (readRecords(await store.get(key)).find(r => r.instance_id === id)?.adopting_by?.by !== mine) continue
    try {
      await adopt(id, mine)
      adopted.push(id)
    } catch (err) {
      failure ??= err
    }
  }
  if (adopted.length > 0) {
    // read again: a claim may have written since the first read
    const left = readRecords(await store.get(key)).filter(r => !adopted.includes(r.instance_id))
    await store.set(key, left)
  }
  if (failure !== undefined) throw failure
  return adopted
}

/**
 * This Claude Code's pid, trusted only when two independent facts agree with
 * it: the messaging socket's name (when there is a socket) carries the same
 * pid, and that pid's command line is a claude. Anything else is undefined, and
 * the record falls back to the 24 h rule.
 * @param {{
 *   readPid: () => Promise<number|undefined>,
 *   socket: string|undefined,
 *   processArgs: (pid: string) => Promise<string|undefined>,
 * }} input
 * @returns {Promise<number|undefined>}
 */
export async function verifiedOwnPid({ readPid, socket, processArgs }) {
  try {
    const pid = await readPid()
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return undefined
    if (socket && String(pid) !== pidFromSocket(socket)) return undefined
    return /claude/i.test((await processArgs(String(pid))) ?? '') ? pid : undefined
  } catch {
    return undefined
  }
}
