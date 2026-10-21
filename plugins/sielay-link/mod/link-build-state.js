// The build this session reports, as plain data and pure transitions; the mod
// keeps it in `$.state` (link-build-hooks.js). Three sources merge into it:
// what /si:build-auto declares through link_build_stage, the subagents seen
// live (classic SubagentStart/Stop, agent.spawn, turn.complete) and the token
// usage and duration (usage.active_ms) of every turn of the session. Nothing is tracked while no build is
// declared. Every transition returns the same object when nothing changed, so
// the caller can skip the write.

import { validateBuild } from './link-build-validate.js'

/** A subagent with no signal for this long is dropped from the live list. */
export const SUBAGENT_EXPIRY_MS = 30 * 60_000
/** A tool call refreshes a subagent's signal at most this often (fewer writes). */
export const SEEN_REFRESH_MS = 60_000
/** What link_build_stage may set: the contract minus what the mod itself fills. */
export const DECLARED_KEYS = Object.freeze([
  'build_id', 'role', 'stage', 'status', 'outcome', 'title', 'repo', 'plan', 'branch', 'pr', 'flags',
  'plan_progress', 'phase', 'gate', 'summary', 'delivery', 'linear', 'links', 'stage_since',
])
const COUNTS = /** @type {const} */ (['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'])
const ZERO_USAGE = Object.freeze({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, turns: 0 })

/**
 * @typedef {import('../types/index.js').LinkBuildState} BuildState
 * @typedef {import('../types/index.js').LinkBuildSubagent} Subagent
 */

/** @param {number} ms */
const iso = ms => new Date(ms).toISOString()
/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)

/** @param {Record<string, Subagent>} subs @param {number} now */
function liveCount(subs, now) {
  return Object.values(subs).filter(s => now - s.seen <= SUBAGENT_EXPIRY_MS).length
}

/**
 * Merges a link_build_stage call. A new build_id starts a new build (usage and
 * peak from zero, the subagents still running carried over); the same one
 * merges field by field, `delivery` one level deep. A stage change with no
 * `stage_since` stamps it now.
 * @param {BuildState|null} state @param {Record<string, unknown>} input @param {number} now
 * @returns {BuildState}
 */
export function declareBuild(state, input, now) {
  /** @type {Record<string, unknown>} */
  const picked = {}
  for (const k of DECLARED_KEYS) if (input[k] !== undefined) picked[k] = input[k]
  const same = state !== null && state.declared.build_id === picked.build_id
  const prev = same ? state.declared : {}
  const declared = { ...prev, ...picked }
  if (isObj(prev.delivery) && isObj(picked.delivery)) declared.delivery = { ...prev.delivery, ...picked.delivery }
  if (picked.stage_since === undefined && (!same || prev.stage !== declared.stage)) declared.stage_since = iso(now)
  const subagents = pruneExpired(state, now)?.subagents ?? {}
  return {
    declared,
    started_at: same ? state.started_at : iso(now),
    subagents,
    peak: same ? state.peak : liveCount(subagents, now),
    usage: same ? state.usage : null,
  }
}

/**
 * Adds or completes a live subagent. SubagentStart brings its type, the
 * agent.spawn result its description; either may come first.
 * @param {BuildState|null} state @param {{ id: unknown, type?: unknown, description?: unknown }} sub @param {number} now
 * @returns {BuildState|null}
 */
export function subagentUp(state, sub, now) {
  if (!state || typeof sub.id !== 'string' || sub.id === '') return state
  const base = pruneExpired(state, now) ?? state
  const old = base.subagents[sub.id]
  /** @type {Subagent} */
  const next = { id: sub.id, started_at: old?.started_at ?? iso(now), seen: now }
  const type = typeof sub.type === 'string' && sub.type ? sub.type : old?.type
  const description = typeof sub.description === 'string' && sub.description ? sub.description : old?.description
  if (type) next.type = type
  if (description) next.description = description
  const subagents = { ...base.subagents, [sub.id]: next }
  return { ...base, subagents, peak: Math.max(base.peak, liveCount(subagents, now)) }
}

/**
 * A tool call inside a subagent: refreshes its signal (never adds one).
 * @param {BuildState|null} state @param {unknown} id @param {number} now
 */
export function subagentSeen(state, id, now) {
  const old = state && typeof id === 'string' ? state.subagents[id] : undefined
  if (!state || !old || now - old.seen < SEEN_REFRESH_MS) return state
  return { ...state, subagents: { ...state.subagents, [old.id]: { ...old, seen: now } } }
}

/**
 * @param {BuildState|null} state @param {unknown} id
 * @returns {BuildState|null}
 */
export function subagentDown(state, id) {
  if (!state || typeof id !== 'string' || !(id in state.subagents)) return state
  const { [id]: _gone, ...subagents } = state.subagents
  return { ...state, subagents }
}

/**
 * @param {BuildState|null} state @param {number} now
 * @returns {BuildState|null}
 */
export function pruneExpired(state, now) {
  if (!state) return state
  const kept = Object.values(state.subagents).filter(s => now - s.seen <= SUBAGENT_EXPIRY_MS)
  if (kept.length === Object.keys(state.subagents).length) return state
  return { ...state, subagents: Object.fromEntries(kept.map(s => [s.id, s])) }
}

/**
 * Adds one turn's `turn.complete.usage`, main loop or subagent alike. A turn
 * with no usage (interrupted, API error) adds nothing; `model` is the main
 * loop's last, never made up.
 * @param {BuildState|null} state @param {unknown} usage @param {boolean} isMain
 * @returns {BuildState|null}
 */
export function addUsage(state, usage, isMain) {
  if (!state || !isObj(usage)) return state
  /** @param {unknown} n */
  const count = n => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)
  const prev = state.usage ?? { ...ZERO_USAGE }
  /** @type {NonNullable<BuildState['usage']>} */
  const next = { ...prev, turns: prev.turns + 1 }
  for (const k of COUNTS) next[k] = prev[k] + count(usage[k])
  if (isMain && typeof usage.model === 'string' && usage.model) next.model = usage.model
  return { ...state, usage: next }
}

/**
 * Adds one turn's `turn.complete.durationMs` to `usage.active_ms`, main loop or
 * subagent alike, so the hub has the session's active time even when the
 * classic hooks never reach this plugin (then the idle/working state stays
 * unknown and the hub's working_ms is 0). A missing or non-positive duration
 * adds nothing. Separate from addUsage on purpose: an aborted turn has a
 * duration but no usage. It never touches the idle/working state.
 * @param {BuildState|null} state @param {unknown} durationMs
 * @returns {BuildState|null}
 */
export function addActiveTime(state, durationMs) {
  if (!state || typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 1) return state
  const prev = state.usage ?? { ...ZERO_USAGE }
  const active = Math.min(Number.MAX_SAFE_INTEGER, (prev.active_ms ?? 0) + Math.floor(durationMs))
  return { ...state, usage: { ...prev, active_ms: active } }
}

/**
 * After a poll that carried `sent`: a build reported `done` is forgotten, so it
 * never reaches the hub again (a closed build is immutable there).
 * @param {BuildState|null} state @param {unknown} sent the `session.build` the poll carried
 * @returns {BuildState|null}
 */
export function forgetIfDone(state, sent) {
  if (!state || !isObj(sent) || sent.status !== 'done') return state
  return state.declared.build_id === sent.build_id && state.declared.status === 'done' ? null : state
}

/**
 * The `session.build` to send, validated with the hub's rules. When it is too
 * big, subagent descriptions go first, then the oldest subagents.
 * @param {BuildState} state @param {number} now
 * @returns {ReturnType<typeof validateBuild>}
 */
export function buildReport(state, now) {
  /** @type {Record<string, unknown>[]} */
  let subs = Object.values(state.subagents)
    .filter(s => now - s.seen <= SUBAGENT_EXPIRY_MS)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map(({ seen: _seen, ...s }) => s)
  const report = () => validateBuild({ ...state.declared, subagents: subs, subagents_peak: state.peak, usage: state.usage, started_at: state.started_at }, now)
  let r = report()
  if (r.error !== 'too_big') return r
  subs = subs.map(({ description: _d, ...s }) => s)
  for (r = report(); r.error === 'too_big' && subs.length > 0; r = report()) subs = subs.slice(1)
  return r
}
