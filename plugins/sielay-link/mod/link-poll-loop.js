// The long-poll loop: one self-rescheduling timer (`$.clock.after` in the mod)
// with try/finally, so an exception never ends it. No `$`: everything is
// injected. The session (and its instance_id, see link-instance-identity.js) is re-read
// on every round, so /clear and --resume are picked up.
//
// Errors: 503 pauses (60 s), 401 stops until restart(), 429 waits
// retry-after or backs off, anything else backs off 1 s → 60 s.
//
// Every status goes out with a stable code (onStatus's third argument), the
// one link_build_stage answers `reason` with: the status itself when the hub
// said something definite, `too_many_sessions` for the session cap, and
// `unreachable` for every other backoff (network, 5xx, a plain rate limit).
//
// One loop only: every start() opens a new generation and a timer from an
// older one does nothing. A tick that finds another still running (a restart
// while a 25 s poll is in flight) retries shortly instead of returning, so a
// restart can never leave the loop dead. A poll that comes back after a
// restart still hands its messages over (their acks ride the next poll), but
// what it says about the hub (status, session, a 401) belongs to the old
// token and is dropped.

export const WAIT_S = 25
export const MAX_DELAY_MS = 60_000
export const PAUSE_MS = 60_000
export const OFF_RECHECK_MS = 5_000
/** An empty answer that came back faster than this waits this long (no tight loop). */
export const MIN_EMPTY_POLL_MS = 1_000
/** How soon a tick that found another one running tries again. */
export const BUSY_RETRY_MS = 250

/**
 * @typedef {'starting'|'online'|'off'|'unpaired'|'paused'|'unauthorized'|'backoff'} LoopStatus
 * @typedef {'online'|'off'|'unpaired'|'paused'|'unauthorized'|'too_many_sessions'|'unreachable'} LoopCode
 * @typedef {import('./link-inbound-handler.js').Ack} Ack
 */

/**
 * @param {{
 *   schedule: (ms: number, fn: () => void) => void,
 *   getClient: () => ({ poll: (body: object) => Promise<any> } | null),
 *   buildSession: () => Promise<{ instance_id: string } & Record<string, unknown>>,
 *   handler: { handlePoll: (instanceId: string, data: any) => Promise<Ack[]> },
 *   isOff: () => Promise<boolean>,
 *   onStatus?: (status: LoopStatus, detail: string|undefined, code: LoopCode) => Promise<void> | void,
 *   onSession?: (session: { id?: string, address?: string, name_assigned?: string }) => Promise<void> | void,
 *   onPolled?: (sent: { instance_id: string } & Record<string, unknown>) => Promise<void> | void,
 *   now?: () => number | Promise<number>,
 * }} deps
 */
export function createPollLoop({ schedule, getClient, buildSession, handler, isOff, onStatus = () => {}, onSession = () => {}, onPolled = () => {}, now = () => Date.now() }) {
  /** @type {Ack[]} */
  let pendingAcks = []
  let failures = 0
  let stopped = true
  let running = false
  let generation = 0

  /** @returns {number} */
  function backoff() {
    failures += 1
    return Math.min(MAX_DELAY_MS, 1000 * 2 ** (failures - 1))
  }

  /** @param {number} gen */
  async function tick(gen) {
    if (gen !== generation || stopped) return
    if (running) {
      schedule(BUSY_RETRY_MS, () => void tick(gen))
      return
    }
    running = true
    let delay = 0
    const current = () => gen === generation
    try {
      if (await isOff()) {
        delay = OFF_RECHECK_MS
        await onStatus('off', undefined, 'off')
        return
      }
      const client = getClient()
      if (!client) {
        delay = OFF_RECHECK_MS
        await onStatus('unpaired', undefined, 'unpaired')
        return
      }
      const session = await buildSession()
      const ack = pendingAcks
      pendingAcks = []
      /** @type {any} */
      let data
      const startedAt = await now()
      try {
        data = await client.poll({ session, ...(ack.length ? { ack } : {}), wait_s: WAIT_S })
      } catch (err) {
        pendingAcks = [...ack, ...pendingAcks]
        throw err
      }
      failures = 0
      if (data?.session && current()) await onSession(data.session)
      pendingAcks.push(...(await handler.handlePoll(session.instance_id, data ?? {})))
      try {
        await onPolled(session)
      } catch {
        // after-poll bookkeeping (the build's cleanup) retries on the next poll
      }
      if (current()) await onStatus('online', undefined, 'online')
      const after = Number(data?.poll_after_ms)
      delay = pendingAcks.length ? 0 : Number.isFinite(after) ? Math.min(MAX_DELAY_MS, Math.max(0, after)) : 0
      const empty = !Array.isArray(data?.messages) || data.messages.length === 0
      if (empty && !pendingAcks.length && (await now()) - startedAt < MIN_EMPTY_POLL_MS) {
        delay = Math.max(delay, MIN_EMPTY_POLL_MS)
      }
    } catch (err) {
      const e = /** @type {{ kind?: string, code?: string, retryAfterMs?: number, message?: string }} */ (err ?? {})
      if (!current()) {
        // the old generation's error: the new one reports for itself
      } else if (e.kind === 'unauthorized') {
        stopped = true
        await safeStatus('unauthorized', 'el hub rechazó el token: vuelve a emparejar con /link pair <slot>', 'unauthorized')
      } else if (e.code === 'too_many_sessions') {
        // The device's cap on sessions online at once (16), not a request rate:
        // nothing changes by retrying sooner, so wait steadily and say why.
        delay = MAX_DELAY_MS
        await safeStatus('backoff', 'esta máquina ya tiene 16 sesiones en línea (el tope); reintento cada minuto', 'too_many_sessions')
      } else if (e.kind === 'paused') {
        delay = PAUSE_MS
        await safeStatus('paused', 'sielay-link está apagado en el hub', 'paused')
      } else if (e.kind === 'rate_limited' && typeof e.retryAfterMs === 'number') {
        delay = Math.min(MAX_DELAY_MS, Math.max(1000, e.retryAfterMs))
        await safeStatus('backoff', 'demasiadas peticiones; esperando', 'unreachable')
      } else {
        delay = backoff()
        await safeStatus('backoff', String(e.message ?? err), 'unreachable')
      }
    } finally {
      running = false
      if (!stopped && gen === generation) schedule(delay, () => void tick(gen))
    }
  }

  /** @param {LoopStatus} status @param {string} detail @param {LoopCode} code */
  async function safeStatus(status, detail, code) {
    try {
      await onStatus(status, detail, code)
    } catch {
      // status display must never break the loop
    }
  }

  return {
    /** Starts (or restarts after a 401 or a re-pairing) with a fresh generation. */
    start() {
      generation += 1
      stopped = false
      failures = 0
      const gen = generation
      schedule(0, () => void tick(gen))
    },
    stop() {
      stopped = true
      generation += 1
    },
    /** @returns {boolean} */
    get isStopped() {
      return stopped
    },
    /** Acks waiting for the next poll (exposed for tests and status). */
    get pendingAcks() {
      return [...pendingAcks]
    },
  }
}
