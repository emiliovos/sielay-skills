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

/**
 * The modes a peer's message may run in on its own: bypass, and Claude Code's
 * `auto`, whose classifier still screens every action. `default`, `plan` and
 * `acceptEdits` never auto-run. The hub applies the same rule.
 * @param {unknown} mode
 */
export const isAutoRunMode = (mode) => mode === 'bypassPermissions' || mode === 'auto'

/** The launch sample's event (link-launch-mode.js): read from the command line or settings, not from a hook. */
const LAUNCH_EVENT = 'SessionStart'

/** The policy in force. Switching policies is this one line. */
export const IDLE_POLICY = IDLE_POLICY_LAST_SEEN

/**
 * The oldest a mode reading may be and still count as fresh, in every branch:
 * idle under the last-seen policy, and a "running" turn too, since a turn
 * that ends on Esc or an API error may leave no end mark at all.
 *
 * Bypass and auto keep their reading for 7 days, so a terminal left in bypass
 * over a weekend still takes its peer's messages; the hub still auto-runs one
 * only from a pair with auto_run on. Every other mode keeps 24 h.
 */
export const AUTO_RUN_FRESH_MAX_MS = 7 * 24 * 60 * 60 * 1000
export const MODE_FRESH_MAX_MS = 24 * 60 * 60 * 1000
/** Only bypass and auto can be fresh while idle, so the idle window is theirs. */
export const IDLE_FRESH_MAX_MS = AUTO_RUN_FRESH_MAX_MS

/** @param {string} mode */
export const freshMaxMs = (mode) => (isAutoRunMode(mode) ? AUTO_RUN_FRESH_MAX_MS : MODE_FRESH_MAX_MS)

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
 * - Older than its mode's cap (freshMaxMs): never fresh, whatever the branch.
 * - The newest sample is newer than the last turn end: a turn is running, fresh.
 * - Otherwise the session is idle and the policy decides.
 *
 * `lastStopAt` is the last turn end the mod saw: classic Stop and
 * `turn.complete`, which also fires for an aborted or failed turn.
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
  if (ageMs > freshMaxMs(latest.mode)) {
    return { mode: latest.mode, fresh: false, state: state === 'working' ? 'unknown' : state, ageMs }
  }
  if (state === 'working') return { mode: latest.mode, fresh: true, state, ageMs }

  const fresh =
    policy === IDLE_POLICY_LAST_SEEN && isAutoRunMode(latest.mode) &&
    // `auto` asked for at launch may not be granted (an organization or plan
    // without it starts in default): it counts once a hook has shown it.
    !(latest.mode === 'auto' && latest.event === LAUNCH_EVENT)
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
