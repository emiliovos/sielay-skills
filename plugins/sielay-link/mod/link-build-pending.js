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
    pending.push({ declared: state.declared, started_at: state.started_at, at: now })
  }
  return pending.slice(-PENDING_MAX)
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
 * It carries no subagents or usage: those belong to the current build.
 * @param {BuildState} state @param {number} now
 * @returns {ReturnType<typeof validateBuild>|undefined}
 */
export function pendingReport(state, now) {
  const head = state.pending?.[0]
  if (!head) return undefined
  return validateBuild({ ...head.declared, subagents: [], started_at: head.started_at }, now)
}

/**
 * After a poll that carried `sent`: a queued build that went out leaves the
 * queue (a closed shell with nothing left is dropped); the current one is no
 * longer unsent when the poll carried the declaration made at `touchedAt`,
 * with no call in between.
 * @param {BuildState|null} state @param {unknown} sent @param {number|undefined} touchedAt
 * @returns {BuildState|null}
 */
export function markSent(state, sent, touchedAt) {
  if (!state || sent === null || typeof sent !== 'object') return state
  const id = /** @type {Record<string, unknown>} */ (sent).build_id
  const [head, ...rest] = state.pending ?? []
  if (head && head.declared.build_id === id) {
    const { pending: _p, ...base } = state
    const next = rest.length > 0 ? { ...base, pending: rest } : base
    return next.closed && rest.length === 0 && Object.keys(next.open ?? {}).length === 0 ? null : next
  }
  if (state.closed || !state.unsent || state.declared.build_id !== id || state.touched_at !== touchedAt) return state
  const { unsent: _u, ...carried } = state
  return carried
}
