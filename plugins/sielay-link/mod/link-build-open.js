// The other builds this session still has open, besides the current one
// (link-build-state.js): pure helpers over `state.open`, a map of build_id ->
// ms of that build's last report. The poll sends them as `session.open_builds`
// so the hub does not close their membership when another build takes over.

/** @typedef {import('../types/index.js').LinkBuildState} BuildState */

/** A build displaced by a newer declaration stays reported as open this long without a report of its own. */
export const OPEN_BUILD_EXPIRY_MS = 24 * 3_600_000
/** At most this many other open builds ride in a poll (the hub's per-owner live cap). */
export const OPEN_BUILDS_MAX = 12
/**
 * The open map without entries that went 24 h with no report.
 * @param {Record<string, number>|undefined} open @param {number} now
 * @returns {Record<string, number>}
 */
export function pruneOpen(open, now) {
  return Object.fromEntries(Object.entries(open ?? {}).filter(([, at]) => now - at <= OPEN_BUILD_EXPIRY_MS))
}

/**
 * The other open builds after a declaration: the previous current build joins
 * them when a different one takes over (unless it was done), and the one that
 * becomes current leaves. Entries with no report for 24 h are dropped.
 * @param {BuildState|null} state @param {boolean} same @param {string} id @param {number} now
 * @returns {Record<string, number>}
 */
export function displace(state, same, id, now) {
  const open = pruneOpen(state?.open, now)
  if (state && !state.closed && !same && state.declared.status !== 'done') {
    open[String(state.declared.build_id)] = state.touched_at ?? now
  }
  delete open[id]
  return open
}

/**
 * The ids of the other open builds for the poll: newest report first, at most
 * 12, never the current one.
 * @param {BuildState|null} state @param {number} now
 * @returns {string[]}
 */
export function openBuildIds(state, now) {
  if (!state) return []
  const current = state.closed ? undefined : state.declared.build_id
  return Object.entries(state.open ?? {})
    .filter(([id, at]) => id !== current && now - at <= OPEN_BUILD_EXPIRY_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, OPEN_BUILDS_MAX)
    .map(([id]) => id)
}

