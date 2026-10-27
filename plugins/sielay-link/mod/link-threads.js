// Thread registry: which numbered thread (①…⑳) a message belongs to, whether
// another thread was open when it happened, and the clock time it is shown
// with. Everything is fixed when the event happens and the rows only read it,
// so drawing a row again never changes it. Kept in `$.state` (key `threads`),
// per session. Pure (the state and the clock are injected).

import { safeField } from './link-inbound-framing.js'
import { ADDRESS } from './link-tool-address.js'

/** A thread with a turn in this long and no closure counts as open. */
export const THREAD_ACTIVE_MS = 30 * 60 * 1000
/** Numbers go ①…⑳; past 20 open threads the oldest one gives its number up. */
export const MAX_THREAD_NUMBER = 20
/** Marks kept, oldest dropped first. */
export const MAX_MARKS = 200
/** A thread idle for this long is forgotten (its marks stay until pruned). */
const THREAD_KEEP_MS = 24 * 60 * 60 * 1000

/**
 * @typedef {import('../types/index.js').LinkThread} Thread
 * @typedef {import('../types/index.js').LinkThreadMark} Mark
 * @typedef {import('../types/index.js').LinkThreadClosure} Closure
 * @typedef {import('../types/index.js').LinkThreadRegistry} Registry
 * @typedef {{ by: string|null, reason: Closure['reason'] }} Ending
 */

/** «①» for 1 … «⑳» for 20; '' for anything else. @param {unknown} n */
export const threadGlyph = n => (Number.isInteger(n) && /** @type {number} */ (n) >= 1 && /** @type {number} */ (n) <= MAX_THREAD_NUMBER ? String.fromCodePoint(0x2460 + /** @type {number} */ (n) - 1) : '')

/** HH:MM in the process's zone, with no dependence on Intl. @param {number} ms */
export function hhmm(ms) {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * A hub timestamp as ms. SQLite's «YYYY-MM-DD HH:MM:SS» carries no zone and is UTC.
 * @param {unknown} sentAt @returns {number|null}
 */
export function sentAtMs(sentAt) {
  if (typeof sentAt !== 'string') return null
  const bare = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(sentAt)
  const ms = Date.parse(bare ? `${sentAt.replace(' ', 'T')}Z` : sentAt)
  return Number.isNaN(ms) ? null : ms
}

/**
 * The turn number of a delivery: the one link_read prints as «turno N», so a row can find the mark from the text.
 * The hub sends `turn` equal to `seq`.
 * @param {{ seq?: unknown, turn?: unknown }} d @returns {number|undefined}
 */
export function seqOf(d) {
  if (Number.isInteger(d.turn)) return /** @type {number} */ (d.turn)
  return Number.isInteger(d.seq) ? /** @type {number} */ (d.seq) : undefined
}

/** The key of an incoming message's mark. @param {string} conv @param {number} seq */
export const inboundKey = (conv, seq) => `${safeField(conv, /[^A-Za-z0-9-]+/g)}#${seq}`

/**
 * How the hub says a conversation ended (`conversation` on a delivery), or null while it is open
 * or the hub does not say (an older hub).
 * @param {unknown} conversation @returns {Ending|null}
 */
export function endingOf(conversation) {
  const c = /** @type {{ status?: unknown, closed_reason?: unknown, closed_by?: unknown }|null} */ (conversation)
  if (!c || typeof c !== 'object') return null
  if (c.status === 'capped') return { by: null, reason: 'cap' }
  if (c.status !== 'closed' && c.status !== 'archived') return null
  const by = typeof c.closed_by === 'string' && ADDRESS.test(c.closed_by) ? c.closed_by : null
  return { by, reason: c.closed_reason === 'idle' || c.closed_reason === 'admin' ? c.closed_reason : 'end' }
}

/** @param {unknown} v @returns {Registry} */
function sanitize(v) {
  const o = /** @type {Partial<Registry>|null} */ (v)
  const plain = /** @param {unknown} x */ x => (x !== null && typeof x === 'object' && !Array.isArray(x) ? /** @type {any} */ (x) : {})
  return { threads: plain(o?.threads), marks: plain(o?.marks) }
}

/** @param {Registry|undefined|null} reg @param {string} key @returns {Mark|undefined} */
export function markFrom(reg, key) {
  const m = reg?.marks?.[key]
  return m && typeof m === 'object' && Number.isInteger(m.n) ? m : undefined
}

/**
 * @param {{ get: () => Promise<unknown>, set: (v: Registry) => Promise<unknown>, now: () => number | Promise<number> }} io
 */
export function createThreads({ get, set, now }) {
  let queue = Promise.resolve()
  /** One write at a time: two read-modify-writes of the same key would lose a mark. @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  function serial(fn) {
    const run = queue.then(fn)
    queue = run.then(() => {}, () => {})
    return run
  }

  /**
   * Registers one event and returns its mark; an event that already has one keeps it (a redelivery counts nothing twice).
   * @param {{ key: string, conv: string, peer: string, project?: string, at?: number, seq?: number, ending?: Ending|null,
   *   last?: boolean, out?: boolean, state?: 'strip'|'held', refused?: boolean }} ev
   * @returns {Promise<Mark>}
   */
  function record(ev) {
    return serial(async () => {
      const reg = sanitize(await get())
      const known = markFrom(reg, ev.key)
      if (known) return known
      const t0 = await now()
      const at = ev.at ?? t0
      const isOpen = (/** @type {Thread} */ t) => !t.closed && t0 - t.last_at <= THREAD_ACTIVE_MS
      const others = Object.entries(reg.threads).filter(([id]) => id !== ev.conv)
      const live = others.map(([, t]) => t).filter(isOpen)
      let t = reg.threads[ev.conv]
      let first = false
      if (!t) {
        t = reg.threads[ev.conv] = { n: 0, peer: ev.peer, turns: 0, last_at: t0, closed: null }
        first = true
      }
      // Once another thread was open beside it, a thread keeps its number on every later row.
      const crossed = live.length > 0 || t.crossed === true
      if (crossed) t.crossed = true
      const taken = new Set(live.map(x => x.n))
      if (!Number.isInteger(t.n) || t.n < 1 || taken.has(t.n)) {
        t.n = lowestFree(taken, live)
        first = true
      }
      t.peer = ev.peer
      if (ev.project) t.project = ev.project
      if (!ev.refused) {
        t.turns = Math.max(t.turns, ev.seq ?? t.turns + 1)
        t.last_at = t0
      }
      /** @type {Mark['closed']} */
      let closed
      if (ev.ending && !t.closed && ev.last !== false) {
        t.closed = { by: ev.ending.by, reason: ev.ending.reason, at }
        closed = { ...t.closed, hhmm: hhmm(at), turns: t.turns }
      }
      /** @type {Mark} */
      const mark = { conv: ev.conv, n: t.n, crossed, hhmm: hhmm(at), first, peer: ev.peer }
      const project = ev.project ?? t.project
      if (project) mark.project = project
      if (ev.out) mark.out = true
      if (ev.state) mark.state = ev.state
      if (ev.refused) mark.refused = true
      if (closed) mark.closed = closed
      reg.marks[ev.key] = mark
      prune(reg, t0)
      await set(reg)
      return mark
    })
  }

  return {
    record,
    /** @returns {Promise<Registry>} */
    read: () => serial(async () => sanitize(await get())),
  }
}

/** The lowest free number, or the oldest live thread's when all 20 are taken. @param {Set<number>} taken @param {Thread[]} live */
function lowestFree(taken, live) {
  for (let n = 1; n <= MAX_THREAD_NUMBER; n++) if (!taken.has(n)) return n
  return [...live].sort((a, b) => a.last_at - b.last_at)[0]?.n ?? 1
}

/** @param {Registry} reg @param {number} t0 */
function prune(reg, t0) {
  for (const [id, t] of Object.entries(reg.threads)) if (t0 - t.last_at > THREAD_KEEP_MS) delete reg.threads[id]
  const keys = Object.keys(reg.marks)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_MARKS))) delete reg.marks[k]
}

/** @typedef {ReturnType<typeof createThreads>} Threads */

/**
 * The incoming message's mark: registered where it enters the inbox (after the
 * dedupe), only when it has none. `last` is false for a card that is not the
 * highest turn of its conversation in the same poll, so the closure lands once, on the last.
 * @param {Threads} threads
 * @param {import('./link-inbound-framing.js').Delivery} d
 * @param {{ last?: boolean }} [opts]
 * @returns {Promise<Mark|null>}
 */
export async function recordInbound(threads, d, opts = {}) {
  const seq = seqOf(d)
  if (seq === undefined) return null
  const peer = safeField(d.from?.address, /[^a-z0-9/-]+/g, true)
  const project = typeof d.from?.project === 'string' && d.from.project.trim() !== ''
    ? safeField(d.from.project, /[^\p{L}\p{N} ._-]+/gu).slice(0, 60)
    : undefined
  return threads.record({
    key: inboundKey(d.conversation_id, seq), conv: safeField(d.conversation_id, /[^A-Za-z0-9-]+/g), peer, project,
    at: sentAtMs(d.sent_at) ?? undefined, seq, ending: endingOf(d.conversation), last: opts.last,
  })
}

/**
 * The mark of a message this session sent with link_send / link_reply, keyed by
 * the tool call. `end` closes the thread by this session; `closed` is the hub's
 * 409 conversation_closed (the send was refused, nothing counts as a turn).
 * @param {Threads} threads
 * @param {{ toolUseId: unknown, conv: string, to: string, end?: boolean, gate?: unknown, turn?: unknown,
 *   closed?: { by?: unknown, reason?: unknown } }} sent
 * @param {unknown} self this session's address
 * @returns {Promise<Mark|null>}
 */
export async function recordOutbound(threads, sent, self) {
  if (typeof sent.toolUseId !== 'string' || sent.toolUseId === '') return null
  /** @type {Ending|null} */
  let ending = null
  if (sent.closed) {
    const by = typeof sent.closed.by === 'string' && ADDRESS.test(sent.closed.by) ? sent.closed.by : null
    ending = { by, reason: sent.closed.reason === 'idle' || sent.closed.reason === 'admin' ? sent.closed.reason : 'end' }
  } else if (sent.end === true) {
    ending = { by: typeof self === 'string' && ADDRESS.test(self) ? self : null, reason: 'end' }
  }
  return threads.record({
    key: sent.toolUseId.slice(0, 120), conv: safeField(sent.conv, /[^A-Za-z0-9-]+/g), peer: safeField(sent.to, /[^a-z0-9/-]+/g, true),
    seq: Number.isInteger(sent.turn) ? /** @type {number} */ (sent.turn) : undefined, ending, out: true, refused: sent.closed !== undefined,
    state: sent.gate === 'strip' || sent.gate === 'held' ? sent.gate : undefined,
  })
}
