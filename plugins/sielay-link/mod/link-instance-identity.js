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

export const INSTANCE_LEASE_MS = 90_000
export const MAX_RECORDS = 8

/**
 * @param {string} cwdHash @param {string} name
 * @returns {string}
 */
export function instanceKey(cwdHash, name) {
  return `instance.${cwdHash}.${name}`
}

/**
 * @typedef {{ instance_id: string, owner: string, renewed_at: number }} InstanceRecord
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
 * }} input
 * @returns {Promise<string>}
 */
export async function claimInstanceId({ store, key, me, now, ownerAlive, newId, leaseMs = INSTANCE_LEASE_MS }) {
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
 * What a dead instance left in `held.<id>` and `inbox.<id>` goes to the live one.
 * Without a messaging socket a /clear changes the owner (the session id) while
 * the old record is still within its lease, so a new id is minted and the old
 * one's mailboxes would be unreachable. Once an OTHER record of the same key is
 * free (the rule of claimInstanceId), `adopt(from, to)` moves its mailboxes and
 * the record leaves the list. A record whose move fails stays for the next
 * poll and the error is thrown after the others were tried. Never touches
 * another key, nor a record whose owner is alive and renewing.
 * @param {{
 *   store: { get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void> },
 *   key: string, mine: string, now: number,
 *   ownerAlive: (owner: string) => Promise<boolean>,
 *   adopt: (fromId: string, toId: string) => Promise<void>,
 *   leaseMs?: number,
 * }} input
 * @returns {Promise<string[]>} the instance ids adopted
 */
export async function adoptOrphans({ store, key, mine, now, ownerAlive, adopt, leaseMs = INSTANCE_LEASE_MS }) {
  const adopted = []
  /** @type {unknown} */
  let failure
  for (const r of readRecords(await store.get(key))) {
    if (r.instance_id === mine || !(await isFree(r, now, ownerAlive, leaseMs))) continue
    try {
      await adopt(r.instance_id, mine)
      adopted.push(r.instance_id)
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
