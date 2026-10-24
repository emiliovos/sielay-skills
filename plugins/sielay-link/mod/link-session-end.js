// The terminal closing: tells the hub to retire this session so dead rows do
// not pile up. Best effort and bounded: it never throws, never waits longer
// than END_TIMEOUT_MS, and a hub that says no (409 session_busy: the session
// still has a queue or an open conversation) just leaves the row as it was.

import { buildSessionPayload } from './link-session-payload.js'

export const END_TIMEOUT_MS = 3000
// A /clear keeps the session going and a /resume switches conversation inside
// the same process: the poll loop must keep running through both.
const KEEPS_RUNNING = new Set(['clear', 'resume'])

/** @typedef {import('claude-code').EngineInterface} Engine */

/**
 * @param {Engine} $
 * @param {{ client: import('./link-hub-client.js').HubClient|null, loop: { stop: () => void }|null, adapter: any, tmux: any, namePin?: any, buildCarry?: any, buildError?: any }} rt
 * @param {{ reason?: string }} e session.end
 * @param {() => Promise<boolean>} isOff
 */
export async function endOnClose($, rt, e, isOff) {
  try {
    if (KEEPS_RUNNING.has(String(e.reason)) || !rt.client || (await isOff())) return
    const client = rt.client
    rt.loop?.stop()   // a poll landing after the goodbye would claim a fresh row
    const { session } = await buildSessionPayload($, /** @type {any} */ (rt))
    /** @type {Promise<unknown>} */
    const timeout = new Promise(resolve => void $.clock.after(END_TIMEOUT_MS, () => resolve(undefined)))
    await Promise.race([client.endSession({ session }), timeout])
  } catch {
    // closing must never fail because of the hub
  }
}
