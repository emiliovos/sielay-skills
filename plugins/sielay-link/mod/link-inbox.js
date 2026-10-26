// Compact mode (the default): a peer's message enters the session as one line
// that names only the sender, and its full text waits here until the model
// reads it with link_read. The app shows that tool call folded, so the body
// is seen only when someone opens it. SIELAY_LINK_FULL=1 brings back the
// whole card in the conversation.
//
// Kept in `$.store` (machine-wide, survives reloads), keyed by instance_id:
// `inbox.<instance_id>` holds the last INBOX_MAX messages for INBOX_TTL_MS.
// Pure (the store and the clock are injected).

import { safeField } from './link-inbound-framing.js'
import { splitAddress } from './link-render-text.js'
import { who } from './link-render-compact.js'

export const INBOX_MAX = 50
export const INBOX_TTL_MS = 24 * 60 * 60 * 1000

/**
 * @typedef {import('./link-inbound-framing.js').Delivery} Delivery
 * @typedef {import('./link-inbound-store.js').StoreLike} StoreLike
 * @typedef {{ d: Delivery, at: number, read: boolean }} Entry
 */

/**
 * The line the session gets: «📨 mensaje de sielay-2», with the person only
 * when it is not the person of this session. Nothing of the body goes in it.
 * @param {Delivery} d @param {string|undefined} selfAddress
 */
export function compactLine(d, selfAddress) {
  const address = safeField(d.from?.address, /[^a-z0-9/-]+/g, true)
  const [person = '?', , session = '?'] = address.split('/').map(p => p || '?')
  return `📨 mensaje de ${who(person, session, splitAddress(selfAddress)?.person)}`
}

/** @param {StoreLike} store @param {() => number | Promise<number>} now the engine's clock is async */
export function createInbox(store, now) {
  /** @param {string} instanceId @returns {Promise<Entry[]>} */
  async function load(instanceId) {
    const v = await store.get(`inbox.${instanceId}`)
    const cutoff = (await now()) - INBOX_TTL_MS
    return Array.isArray(v) ? v.filter(e => e && typeof e.at === 'number' && e.at >= cutoff && e.d && typeof e.d.id === 'string') : []
  }

  /** @param {string} instanceId @param {Entry[]} entries */
  const save = (instanceId, entries) => store.set(`inbox.${instanceId}`, entries.slice(-INBOX_MAX))

  return {
    /** @param {string} instanceId @param {Delivery} d */
    async add(instanceId, d) {
      const entries = (await load(instanceId)).filter(e => e.d.id !== d.id)
      entries.push({ d, at: await now(), read: false })
      await save(instanceId, entries)
    },

    /**
     * The unread messages (of one conversation, or all), marked read. A
     * conversation with nothing unread gives its last message again.
     * @param {string} instanceId @param {string} [conv]
     * @returns {Promise<Delivery[]>}
     */
    async take(instanceId, conv) {
      const entries = await load(instanceId)
      const mine = entries.filter(e => conv === undefined || e.d.conversation_id === conv)
      let picked = mine.filter(e => !e.read)
      if (picked.length === 0 && conv !== undefined && mine.length > 0) picked = [mine[mine.length - 1]]
      for (const e of picked) e.read = true
      if (picked.length > 0) await save(instanceId, entries)
      return picked.map(e => e.d)
    },
  }
}

/** @typedef {ReturnType<typeof createInbox>} Inbox */
