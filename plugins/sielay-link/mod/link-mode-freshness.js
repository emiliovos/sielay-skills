// Permission-mode freshness: the one place that decides whether the mode this
// session last reported can be trusted right now. Pure (no `$`), so it runs
// under `node --test` and inside the mod alike.
//
// Facts it relies on (Claude Code 2.1.300):
// - `permission_mode` arrives only on classic UserPromptSubmit, PostToolUse,
//   PostToolBatch and Stop; never on SessionStart, PreToolUse or while idle.
// - A shift+tab while idle raises nothing a plugin can read, so an idle
//   reading is always the mode seen at the last event, never a live one.

/** Idle = not fresh: an idle session never auto-runs. */
export const IDLE_POLICY_STRICT = 'strict'
/** Idle keeps the mode seen at the last event for up to IDLE_FRESH_MAX_MS. */
export const IDLE_POLICY_LAST_SEEN = 'last-seen'

/** The policy in force. Switching policies is this one line. */
export const IDLE_POLICY = IDLE_POLICY_LAST_SEEN

/** How long an idle session keeps its last seen mode under the last-seen policy. */
export const IDLE_FRESH_MAX_MS = 12 * 60 * 60 * 1000

/**
 * @typedef {{ mode: string, at: number, event?: string }} ModeSample
 * @typedef {{ mode: string, fresh: boolean, state: 'idle'|'working'|'unknown', ageMs: number|null }} ModeState
 */

/**
 * @param {unknown} s
 * @returns {s is ModeSample}
 */
function isSample(s) {
  if (s === null || typeof s !== 'object') return false
  const o = /** @type {Record<string, unknown>} */ (s)
  return typeof o.mode === 'string' && o.mode !== '' && typeof o.at === 'number' && Number.isFinite(o.at)
}

/**
 * Decides the session's mode and whether it is fresh.
 *
 * - No sample: `unknown`, not fresh.
 * - A live source (none exists today; kept for a future build): fresh.
 * - The newest sample is newer than the last Stop: a turn is running, fresh.
 * - Otherwise the session is idle and the policy decides.
 *
 * @param {{ samples: readonly unknown[], lastStopAt: number|null|undefined, liveSource?: string, now: number, policy?: string }} input
 * @returns {ModeState}
 */
export function modeState({ samples, lastStopAt, liveSource, now, policy = IDLE_POLICY }) {
  const valid = (Array.isArray(samples) ? samples : []).filter(isSample)
  const latest = valid.reduce(
    (/** @type {ModeSample|null} */ best, s) => (best === null || s.at >= best.at ? s : best),
    null,
  )

  if (typeof liveSource === 'string' && liveSource !== '') {
    return { mode: liveSource, fresh: true, state: latest ? stateOf(latest, lastStopAt) : 'unknown', ageMs: 0 }
  }
  if (latest === null) return { mode: 'unknown', fresh: false, state: 'unknown', ageMs: null }

  const ageMs = Math.max(0, now - latest.at)
  const state = stateOf(latest, lastStopAt)
  if (state === 'working') return { mode: latest.mode, fresh: true, state, ageMs }

  const fresh =
    policy === IDLE_POLICY_LAST_SEEN && latest.mode === 'bypassPermissions' && ageMs <= IDLE_FRESH_MAX_MS
  return { mode: latest.mode, fresh, state, ageMs }
}

/**
 * @param {ModeSample} latest
 * @param {number|null|undefined} lastStopAt
 * @returns {'idle'|'working'}
 */
function stateOf(latest, lastStopAt) {
  if (typeof lastStopAt !== 'number') return 'working'
  return latest.at > lastStopAt ? 'working' : 'idle'
}
