// A progress note need not wake an idle session: reading it costs a whole turn
// over the full context. Opt-in with SIELAY_LINK_QUIET_HEADERS (headers split
// by «|», same syntax as SIELAY_LINK_SEND_HEADERS): a message whose first line
// starts with one of them, reaching an idle session, waits for that session's
// next turn or SIELAY_LINK_QUIET_MAX_MIN minutes, whichever comes first.
// `<header> FINAL` always wakes: it says the work ended and someone waits on it.
// Pure (no `$`): the store, the clock and the delivery are injected.

import { parseSendHeaders } from './link-send-headers.js'

export const DEFAULT_QUIET_MAX_MIN = 10

/**
 * @typedef {{ re: RegExp, wake: RegExp, maxMs: number }} QuietRule
 * @typedef {import('./link-inbound-framing.js').Delivery} Delivery
 * @typedef {import('./link-inbound-store.js').HeldMessage} HeldMessage
 */

/**
 * @param {string | undefined | null} spec the headers variable
 * @param {string | undefined | null} [maxMin] the minutes variable; anything but a positive number means the default
 * @returns {QuietRule | null} the rule, or null when nothing is held
 */
export function parseQuietRule(spec, maxMin) {
  const rule = parseSendHeaders(spec)
  if (!rule) return null
  const minutes = Number(maxMin)
  return {
    re: rule.re,
    wake: new RegExp(`${rule.re.source}\\s+FINAL(?![\\p{L}\\p{N}])`, 'u'),
    maxMs: (minutes > 0 ? minutes : DEFAULT_QUIET_MAX_MIN) * 60_000,
  }
}

/**
 * @param {unknown} body the message body
 * @param {QuietRule | null} rule
 * @returns {boolean} whether the message may wait instead of waking the session
 */
export function isQuiet(body, rule) {
  if (!rule || typeof body !== 'string') return false
  const first = body.split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return rule.re.test(first) && !rule.wake.test(first)
}

/**
 * @param {{
 *   readHeld: (instanceId: string) => Promise<HeldMessage[]>,
 *   writeHeld: (instanceId: string, held: HeldMessage[]) => Promise<void>,
 *   quietRule: () => Promise<QuietRule | null>,
 *   isBusy: () => boolean,
 *   now: () => number | Promise<number>,
 *   mayRun: (d: Delivery) => Promise<boolean>,
 *   inject: (d: Delivery, instanceId: string) => Promise<void>,
 *   log: (msg: string) => void,
 * }} deps
 */
export function createHeldQueue({ readHeld, writeHeld, quietRule, isBusy, now, mayRun, inject, log }) {
  /** Polls and turn starts overlap: the list is touched one at a time, so nothing goes in twice. */
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve()
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  function oneAtATime(fn) {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  /**
   * Delivers what is held, oldest first, while the run gate still allows it: a mode
   * that changed while it waited keeps it waiting. A failure keeps it for the next try.
   * @param {string} instanceId
   */
  function flush(instanceId) {
    return oneAtATime(async () => {
      const left = await readHeld(instanceId)
      while (left.length > 0) {
        const { delivery } = left[0]
        if (!(await mayRun(delivery))) return
        try {
          await inject(delivery, instanceId)
        } catch (err) {
          log(`held ${delivery.id} not delivered yet: ${err instanceof Error ? err.message : String(err)}`)
          return
        }
        left.shift()
        await writeHeld(instanceId, left)
      }
    })
  }

  return {
    flush,

    /** @param {string} instanceId @param {Delivery} delivery */
    async add(instanceId, delivery) {
      const at = await now()
      await oneAtATime(async () => writeHeld(instanceId, [...(await readHeld(instanceId)), { delivery, at }]))
    },

    /**
     * What a poll does: a running turn takes the list at no cost (a turn start the hook
     * missed, as after a reload); an idle session only once the oldest is due. All of it
     * then: the turn that opens has room for the rest.
     * @param {string} instanceId
     */
    async flushIfDue(instanceId) {
      const [oldest] = await readHeld(instanceId)
      if (!oldest) return
      const rule = await quietRule()
      if (isBusy() || !rule || (await now()) - oldest.at >= rule.maxMs) await flush(instanceId)
    },
  }
}
