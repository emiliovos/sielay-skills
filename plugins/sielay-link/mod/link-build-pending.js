// Builds waiting for a poll of their own (link-build-state.js): pure helpers
// over `state.pending`. The hub takes one build per poll, so a build displaced
// by another link_build_stage before a poll carried its last declaration (a
// correction, a done) queues here instead of losing those fields. One queued
// build goes out per poll, oldest first, before the current one.

import { validateBuild } from './link-build-validate.js'
import { OPEN_BUILD_EXPIRY_MS, OPEN_BUILDS_MAX } from './link-build-open.js'

/** @typedef {import('../types/index.js').LinkBuildState} BuildState */

/** At most this many displaced builds wait; past it the oldest is dropped. */
export const PENDING_MAX = OPEN_BUILDS_MAX

/**
 * The queue after a declaration of `id`: the current build joins it when a
 * different one takes over before a poll carried it, and `id` leaves it (its
 * queued fields merge into the current build, see takePending).
 * @param {BuildState|null} state @param {boolean} same @param {string} id @param {number} now
 * @returns {NonNullable<BuildState['pending']>}
 */
export function enqueuePending(state, same, id, now) {
  const pending = prunePending(state?.pending, now).filter(p => p.declared.build_id !== id)
  if (state && !state.closed && !same && state.unsent) {
    pending.push({ declared: state.declared, started_at: state.started_at, usage: state.usage, at: now, touched_at: state.touched_at ?? now })
  }
  // past the cap the oldest goes, a done last: dropping it would leave its build open on the hub
  while (pending.length > PENDING_MAX) {
    const i = pending.findIndex(p => p.declared.status !== 'done')
    pending.splice(i === -1 ? 0 : i, 1)
  }
  return pending
}

/**
 * The queue without entries older than the open builds' expiry (a session
 * that stopped polling for a day has nothing worth sending from then).
 * @param {BuildState['pending']} pending @param {number} now
 */
export function prunePending(pending, now) {
  return (pending ?? []).filter(p => now - (p.at ?? now) <= OPEN_BUILD_EXPIRY_MS)
}

/**
 * The queued declaration of `id`, if any: re-declaring a build that has not
 * gone out yet starts from what it had, not from nothing.
 * @param {BuildState|null} state @param {string} id
 */
export function takePending(state, id) {
  return state?.pending?.find(p => p.declared.build_id === id)
}

/**
 * The first queued build as a `session.build`, validated with the hub's rules.
 * It carries the usage it had when displaced; the subagents belong to the current build.
 * @param {BuildState} state @param {number} now
 * @returns {ReturnType<typeof validateBuild>|undefined}
 */
export function pendingReport(state, now) {
  const head = state.pending?.[0]
  if (!head) return undefined
  return validateBuild({ ...head.declared, subagents: [], usage: head.usage, started_at: head.started_at }, now)
}

/**
 * The `open_builds` of a poll that carries the head of the queue: the current
 * build, then the rest of the queue, then the other open ones, without the
 * head and at most OPEN_BUILDS_MAX, so the hub does not take any of them as left.
 * @param {BuildState} state @param {string[]} openIds
 * @returns {string[]}
 */
export function ridingAlong(state, openIds) {
  const headId = state.pending?.[0]?.declared.build_id
  const current = state.closed ? [] : [String(state.declared.build_id)]
  const queued = (state.pending ?? []).slice(1).map(p => String(p.declared.build_id))
  return [...new Set([...current, ...queued, ...openIds])].filter(id => id !== headId).slice(0, OPEN_BUILDS_MAX)
}

/**
 * After a poll that carried `sent`, read from the declaration made at
 * `touchedAt`: the queued build it was leaves the queue (a closed shell with
 * nothing left is dropped), or the current one is no longer unsent. A call that
 * landed while the poll was out moved touched_at, so what it declared stays to
 * go out on the next poll.
 * @param {BuildState|null} state @param {unknown} sent @param {number|undefined} touchedAt
 * @returns {BuildState|null}
 */
export function markSent(state, sent, touchedAt) {
  if (!state || sent === null || typeof sent !== 'object') return state
  const id = /** @type {Record<string, unknown>} */ (sent).build_id
  const [head, ...rest] = state.pending ?? []
  if (head && head.declared.build_id === id && head.touched_at === touchedAt) {
    const { pending: _p, ...base } = state
    const next = rest.length > 0 ? { ...base, pending: rest } : base
    return next.closed && rest.length === 0 && Object.keys(next.open ?? {}).length === 0 ? null : next
  }
  if (state.closed || !state.unsent || state.declared.build_id !== id || state.touched_at !== touchedAt) return state
  const { unsent: _u, ...carried } = state
  return carried
}
