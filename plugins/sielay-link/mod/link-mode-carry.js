// The mode seen before a /clear, carried into the conversation that follows.
//
// A /clear keeps the process (and its permission mode) but the host starts a
// new session: `$.state` comes back empty and `session.start` does not run
// again, so without this a cleared session reported `unknown` until its first
// prompt and a message for it fell to the strip.
//
// What is carried is the last sample seen, never a fresh reading: a shift+tab
// seen before the /clear still wins, and the sample keeps its age, so the
// 24 h cap of link-mode-freshness.js counts from when it was really seen.
// It is restored only into a session with no sample of its own.

const MODE_SAMPLES = /** @type {const} */ ({ plugin: 'sielay-link', key: 'modeSamples' })
const LAST_STOP_AT = /** @type {const} */ ({ plugin: 'sielay-link', key: 'lastStopAt' })

/** @typedef {import('claude-code').EngineInterface} Engine */
/** @typedef {{ sample: import('../types/index.js').LinkModeSample, lastStopAt: number|null }} ModeCarry */
/** @typedef {{ modeCarry: ModeCarry|null }} CarryRuntime */

/**
 * The newest well-formed sample, or null.
 * @param {unknown} samples
 * @returns {import('../types/index.js').LinkModeSample|null}
 */
export function latestSample(samples) {
  let best = null
  for (const s of Array.isArray(samples) ? samples : []) {
    if (s === null || typeof s !== 'object') continue
    const { mode, at, event } = /** @type {Record<string, unknown>} */ (s)
    if (typeof mode !== 'string' || mode === '' || typeof at !== 'number' || !Number.isFinite(at)) continue
    if (best === null || at >= best.at) best = { mode, at, event: typeof event === 'string' ? event : '' }
  }
  return best
}

/**
 * session.end: on a /clear, keeps the last sample in memory for the next
 * conversation; any other end drops what was kept. Never throws: a failed
 * reading carries nothing.
 * @param {Engine} $ @param {CarryRuntime} rt @param {{ reason?: string }} e
 */
export async function carryModeOnClear($, rt, e) {
  rt.modeCarry = null // any end drops an older carry: it never reaches a /resume
  if (e.reason !== 'clear') return
  try {
    const [{ value: samples = [] }, { value: lastStopAt = null }] = await Promise.all([$.state.get(MODE_SAMPLES), $.state.get(LAST_STOP_AT)])
    const sample = latestSample(samples)
    if (sample) rt.modeCarry = { sample, lastStopAt: typeof lastStopAt === 'number' ? lastStopAt : null }
  } catch (err) {
    $.ui.log(`sielay-link: no se guardó el modo antes de /clear (${err instanceof Error ? err.name : typeof err})`)
  }
}

/**
 * Puts the carried sample back when the session has none, and marks it idle
 * (nothing runs right after a /clear). While the session still holds the
 * carried sample it is the old conversation, before the host swaps it: the
 * carry waits. Any other sample means the new conversation already reported
 * its own mode, and the carry is dropped. The write is versioned, so a sample
 * recorded meanwhile wins. Never throws; a failure drops the carry.
 * @param {Engine} $ @param {CarryRuntime} rt
 */
export async function restoreModeCarry($, rt) {
  const carry = rt.modeCarry
  if (!carry) return
  try {
    const held = await $.state.get(MODE_SAMPLES)
    const samples = Array.isArray(held.value) ? held.value : []
    if (samples.length > 0) {
      const oldConversation = samples.some(s => s?.at === carry.sample.at && s?.mode === carry.sample.mode)
      if (!oldConversation) rt.modeCarry = null
      return
    }
    rt.modeCarry = null
    const put = await $.state.set(MODE_SAMPLES, [carry.sample], { ifVersion: held.version })
    if (put.isSet) await $.state.set(LAST_STOP_AT, Math.max(carry.lastStopAt ?? carry.sample.at, carry.sample.at))
  } catch (err) {
    rt.modeCarry = null
    $.ui.log(`sielay-link: no se restauró el modo tras /clear (${err instanceof Error ? err.name : typeof err})`)
  }
}
