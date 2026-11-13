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
// and /clear, different per terminal, gone when the process exits), else the
// session id. A record is this session's when the owner is us; it is free when
// its owner is no longer alive (socketOwnerAlive: the socket file outlives its
// process, so the PID in its name is what tells) or stopped renewing for
// INSTANCE_LEASE_MS. A new
// id is minted only while every record is held by another live process.
// Two processes claiming at the same instant may race; the next poll settles it.
//
// Adopting a record's mailboxes is stricter than claiming its id: it needs
// positive proof that the owner is dead, because a lapsed lease alone also
// happens to a live terminal (`/link off` stops renewing, a suspend lasts
// longer than the lease) and its unread and held messages must stay put.
// A `sock:` owner is dead when its process is gone (the lease is ignored). A
// `sess:` owner is dead when the `pid` stored in the record no longer runs, or
// is our own pid (a /clear inside the same process). A record written before
// `pid` existed has no proof, so it is adopted only after STALE_NO_PID_MS
// without renewal (a day: any live terminal that merely paused is long back).

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
 * A record is free when its lease lapsed or its owner is gone.
 * @param {InstanceRecord} r @param {number} now @param {(owner: string) => Promise<boolean>} ownerAlive @param {number} leaseMs
 */
async function isFree(r, now, ownerAlive, leaseMs) {
  return now - r.renewed_at > leaseMs || !(await ownerAlive(r.owner))
}

/**
 * @param {{
 *   store: { get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void> },
 *   key: string,
 *   me: string,
 *   now: number,
 *   ownerAlive: (owner: string) => Promise<boolean>,
 *   newId: () => string,
 *   leaseMs?: number,
 *   pid?: number,
 * }} input
 * @returns {Promise<string>}
 */
export async function claimInstanceId({ store, key, me, now, ownerAlive, newId, leaseMs = INSTANCE_LEASE_MS, pid }) {
  const records = readRecords(await store.get(key))

  /** @type {InstanceRecord|undefined} */
  let mine = records.find(r => r.owner === me)
  if (!mine) {
    for (const r of [...records].sort((a, b) => b.renewed_at - a.renewed_at)) {
      if (await isFree(r, now, ownerAlive, leaseMs)) {
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
 * Whether the Claude Code process behind a messaging socket still runs. The
 * socket is named `<PID>.sock` and its file stays on disk after the process
 * exits, so on a machine with procfs the PID decides; without procfs, or with
 * a socket named otherwise, the file is all there is to go by.
 * @param {string} path the socket path
 * @param {(path: string) => Promise<boolean>} exists
 * @returns {Promise<boolean>}
 */
export async function socketOwnerAlive(path, exists) {
  if (!(await exists(path))) return false
  const pid = /(?:^|[\\/])([1-9][0-9]{0,9})\.sock$/.exec(path)?.[1]
  if (!pid) return true
  try {
    if (!(await exists('/proc/self'))) return true
    return await exists(`/proc/${pid}`)
  } catch {
    // procfs not readable here: keep the file's answer
    return true
  }
}

/**
 * Positive proof that the record's owner is gone (see the header).
 * @param {InstanceRecord} r @param {number} now
 * @param {(owner: string) => Promise<boolean>} ownerAlive
 * @param {number|undefined} myPid @param {(pid: number) => Promise<boolean>} pidAlive
 */
async function ownerDead(r, now, ownerAlive, myPid, pidAlive) {
  if (r.owner.startsWith('sock:')) return !(await ownerAlive(r.owner))
  if (typeof r.pid === 'number') return r.pid === myPid || !(await pidAlive(r.pid))
  return now - r.renewed_at > STALE_NO_PID_MS
}

/**
 * What a dead instance left in `held.<id>` and `inbox.<id>` goes to the live one.
 * Without a messaging socket a /clear changes the owner (the session id) while
 * the old record is still within its lease, so a new id is minted and the old
 * one's mailboxes would be unreachable. Once an OTHER record of the same key is
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
 *   ownerAlive: (owner: string) => Promise<boolean>,
 *   adopt: (fromId: string, toId: string) => Promise<void>,
 *   pid?: number,
 *   pidAlive?: (pid: number) => Promise<boolean>,
 *   settle?: () => Promise<void>,
 * }} input
 * @returns {Promise<string[]>} the instance ids adopted
 */
export async function adoptOrphans({ store, key, mine, now, ownerAlive, adopt, pid, pidAlive = async () => true, settle = async () => {} }) {
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
