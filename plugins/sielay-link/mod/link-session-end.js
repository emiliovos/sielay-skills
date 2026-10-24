// The terminal closing: tells the hub to retire this session so dead rows do
// not pile up. Best effort and bounded: everything it does (reading the off
// switch, waiting for a poll in flight, the request) sits inside one
// END_TIMEOUT_MS budget, it never throws, and a hub that says no (409
// session_busy: the session still has a queue or an open conversation) just
// leaves the row as it was. It reuses the session object of the last poll, so
// it claims no name and pins nothing.

export const END_TIMEOUT_MS = 3000
// A poll sent less than this long ago may not have reached the hub yet; the
// goodbye waits out the difference so a late poll cannot reopen the row.
export const POLL_SETTLE_MS = 1000
// A /clear keeps the session going and a /resume switches conversation inside
// the same process: the poll loop must keep running through both.
const KEEPS_RUNNING = new Set(['clear', 'resume'])

/** @typedef {import('claude-code').EngineInterface} Engine */

/** @param {Engine} $ @param {number} ms */
function sleep($, ms) {
  return new Promise(resolve => void $.clock.after(ms, () => resolve(undefined)))
}

/**
 * @param {Engine} $
 * @param {{ client: import('./link-hub-client.js').HubClient|null, loop: { stop: () => void, inFlightSince: number|null }|null, lastSession: Record<string, unknown>|null }} rt
 * @param {{ reason?: string }} e session.end
 * @param {() => Promise<boolean>} isOff
 */
export async function endOnClose($, rt, e, isOff) {
  if (KEEPS_RUNNING.has(String(e.reason))) return
  let over = false
  try {
    await Promise.race([
      (async () => {
        const { client, lastSession } = rt
        rt.loop?.stop()   // no new poll may start after the goodbye
        if (!client || !lastSession || (await isOff())) return
        const sent = rt.loop?.inFlightSince
        if (typeof sent === 'number') {
          const wait = POLL_SETTLE_MS - (await $.clock.now() - sent)
          if (wait > 0) await sleep($, wait)
        }
        if (!over) await client.endSession({ session: lastSession })
      })(),
      sleep($, END_TIMEOUT_MS),
    ])
  } catch {
    // closing must never fail because of the hub
  } finally {
    over = true
  }
}
