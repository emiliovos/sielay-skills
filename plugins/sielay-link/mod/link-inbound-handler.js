// Inbound handling: what happens to each delivery a poll brings, and to the
// person's Accept/Reject in the strip. No `$`: the hub client, the adapter,
// the store and the mode reader are injected.
//
// - Dedupe by message id in the store, keyed by instance_id, BEFORE
//   injecting: a redelivered id is re-acked with its first outcome and never
//   injected twice.
// - The run gate reads the mode at the moment of injecting.
// - A delivery that does not run goes to the strip (ack `shown`); only Accept
//   runs it: `/decide accepted`, inject, ack `injected`.
// - An accepted message whose delivery failed is kept in the store (key
//   `accepted.<instance_id>`) and retried on every poll until it lands, so a
//   reload of the mod (or --resume, same session id) cannot lose it.
// - The strip keeps arrival order: a newer message never takes the place of
//   the one on screen.

import { frameInbound } from './link-inbound-framing.js'
import { shouldInject, onStripAccept, onStripReject } from './link-run-gate.js'
import { createInboundStore } from './link-inbound-store.js'

/**
 * @typedef {import('./link-inbound-framing.js').Delivery} Delivery
 * @typedef {{ id: string, outcome: 'injected'|'shown' }} Ack
 * @typedef {import('./link-inbound-store.js').StoreLike} StoreLike
 */

/**
 * @param {unknown} d
 * @returns {d is Delivery}
 */
export function isDelivery(d) {
  if (d === null || typeof d !== 'object') return false
  const o = /** @type {Record<string, unknown>} */ (d)
  return typeof o.id === 'string' && o.id !== '' && typeof o.conversation_id === 'string' && typeof o.body === 'string'
}

/**
 * @param {{
 *   store: StoreLike,
 *   adapter: { inject: (text: string) => Promise<unknown> },
 *   readMode: () => Promise<{ mode: string, fresh: boolean }>,
 *   onStrip: (items: Delivery[]) => Promise<void>,
 *   onConversation?: (d: Delivery) => Promise<void>,
 *   log?: (msg: string) => void,
 * }} deps
 */
export function createInboundHandler({ store, adapter, readMode, onStrip, onConversation, log = () => {} }) {
  /** Strip items this client showed and the hub may not list yet, by id. */
  /** @type {Map<string, Delivery>} */
  const shownLocally = new Map()
  /** @type {Delivery[]} */
  let serverStrip = []
  /** Ids decided at this terminal, hidden even while a stale poll still lists them. */
  const decided = new Set()
  /** First time each strip id was seen, for a stable arrival order. */
  /** @type {Map<string, number>} */
  const arrival = new Map()
  let arrivals = 0

  const { readSeen, remember, readPending, updatePending } = createInboundStore(store)

  function currentStrip() {
    /** @type {Map<string, Delivery>} */
    const all = new Map()
    for (const d of [...serverStrip, ...shownLocally.values()]) {
      if (decided.has(d.id)) continue
      if (!arrival.has(d.id)) arrival.set(d.id, (arrivals += 1))
      all.set(d.id, d)
    }
    return [...all.values()].sort((a, b) => (arrival.get(a.id) ?? 0) - (arrival.get(b.id) ?? 0))
  }

  async function publish() {
    await onStrip(currentStrip())
  }

  /** @param {Delivery} d */
  async function inject(d) {
    await adapter.inject(frameInbound(d))
  }

  return {
    currentStrip,

    /**
     * Handles one poll answer; returns the acks to send with the next poll.
     * @param {string} instanceId
     * @param {{ messages?: unknown[], strip?: unknown[] }} data
     * @returns {Promise<Ack[]>}
     */
    async handlePoll(instanceId, data) {
      /** @type {Ack[]} */
      const acks = []
      for (const [id, d] of Object.entries(await readPending(instanceId))) {
        try {
          await inject(d)
        } catch (err) {
          log(`accepted ${id} still not delivered: ${err instanceof Error ? err.message : String(err)}`)
          continue
        }
        await remember(instanceId, id, 'injected')
        await updatePending(instanceId, p => void delete p[id])
        acks.push({ id, outcome: 'injected' })
      }
      const seen = new Map(await readSeen(instanceId))
      for (const d of (Array.isArray(data.messages) ? data.messages : []).filter(isDelivery)) {
        if (onConversation) await onConversation(d)
        const prior = seen.get(d.id)
        if (prior) {
          acks.push({ id: d.id, outcome: prior })
          continue
        }
        /** @type {'injected'|'shown'} */
        let outcome = 'shown'
        if (shouldInject({ delivery: d, mode: await readMode() })) {
          try {
            await inject(d)
            outcome = 'injected'
          } catch (err) {
            log(`delivery ${d.id} not injected: ${err instanceof Error ? err.message : String(err)}`)
            continue // no ack: the hub's lease redelivers it
          }
        } else {
          shownLocally.set(d.id, d)
        }
        seen.set(d.id, outcome)
        await remember(instanceId, d.id, outcome)
        acks.push({ id: d.id, outcome })
      }
      if (Array.isArray(data.strip)) {
        serverStrip = data.strip.filter(isDelivery)
        for (const d of serverStrip) if (onConversation) await onConversation(d)
      }
      await publish()
      return acks
    },

    /**
     * The person pressed Accept on a strip item.
     * @param {string} id
     * @param {{ instanceId: string, decide: (decision: 'accepted'|'rejected') => Promise<unknown>, ack: (a: Ack) => Promise<unknown> }} ctx
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    async accept(id, ctx) {
      const d = currentStrip().find(x => x.id === id)
      if (!d) return { ok: false, error: 'ya no está en la franja' }
      const seenOutcome = new Map(await readSeen(ctx.instanceId)).get(id)
      if (seenOutcome !== 'injected') {
        const verdict = onStripAccept(d)
        if (!(await readPending(ctx.instanceId))[id]) {
          try {
            await ctx.decide(verdict.decide)
          } catch (err) {
            decided.add(id)
            shownLocally.delete(id)
            await publish()
            return { ok: false, error: `el hub no aceptó la decisión: ${err instanceof Error ? err.message : String(err)}` }
          }
          await updatePending(ctx.instanceId, p => void (p[id] = d))
        }
        try {
          await inject(d)
        } catch (err) {
          return { ok: false, error: `aceptado, pero no se pudo entregar (se reintenta solo): ${err instanceof Error ? err.message : String(err)}` }
        }
        await remember(ctx.instanceId, id, 'injected')
        await updatePending(ctx.instanceId, p => void delete p[id])
      }
      decided.add(id)
      shownLocally.delete(id)
      await publish()
      try {
        await ctx.ack({ id, outcome: 'injected' })
      } catch (err) {
        log(`ack for ${id} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      return { ok: true }
    },

    /**
     * The person pressed Reject on a strip item.
     * @param {string} id
     * @param {{ decide: (decision: 'accepted'|'rejected') => Promise<unknown> }} ctx
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    async reject(id, ctx) {
      const d = currentStrip().find(x => x.id === id)
      if (!d) return { ok: false, error: 'ya no está en la franja' }
      let error
      try {
        await ctx.decide(onStripReject(d).decide)
      } catch (err) {
        error = `el hub no registró el rechazo: ${err instanceof Error ? err.message : String(err)}`
      }
      decided.add(id)
      shownLocally.delete(id)
      await publish()
      return error ? { ok: false, error } : { ok: true }
    },
  }
}

/** @typedef {ReturnType<typeof createInboundHandler>} InboundHandler */
