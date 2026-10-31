// What the inbound handler keeps in `$.store` (machine-wide, survives reloads
// and restarts), keyed by instance_id (the session id):
// - `seen.<instance_id>`: [id, outcome] of the last SEEN_MAX deliveries, the
//   dedupe that keeps a redelivered message from running twice;
// - `accepted.<instance_id>`: accepted messages whose delivery has not landed
//   yet, retried on every poll;
// - `held.<instance_id>`: quiet messages waiting for the next turn, oldest
//   first, already acked to the hub (its lease allows too few retries to wait on).
// No token is ever stored here. Pure (the store is injected).

export const SEEN_MAX = 500

/**
 * @typedef {import('./link-inbound-framing.js').Delivery} Delivery
 * @typedef {{ delivery: Delivery, at: number }} HeldMessage
 * @typedef {{ get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void> }} StoreLike
 */

/** @param {StoreLike} store */
export function createInboundStore(store) {
  /** @param {string} instanceId @returns {Promise<Array<[string, 'injected'|'shown']>>} */
  async function readSeen(instanceId) {
    const v = await store.get(`seen.${instanceId}`)
    return Array.isArray(v) ? v.filter(e => Array.isArray(e) && typeof e[0] === 'string') : []
  }

  /** @param {string} instanceId @param {string} id @param {'injected'|'shown'} outcome */
  async function remember(instanceId, id, outcome) {
    const seen = (await readSeen(instanceId)).filter(([sid]) => sid !== id)
    seen.push([id, outcome])
    await store.set(`seen.${instanceId}`, seen.slice(-SEEN_MAX))
  }

  /** @param {string} instanceId @returns {Promise<Record<string, Delivery>>} */
  async function readPending(instanceId) {
    const v = await store.get(`accepted.${instanceId}`)
    return v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, Delivery>} */ (v) : {}
  }

  /** @param {string} instanceId @param {(p: Record<string, Delivery>) => void} change */
  async function updatePending(instanceId, change) {
    const pending = await readPending(instanceId)
    change(pending)
    await store.set(`accepted.${instanceId}`, pending)
  }

  /** @param {string} instanceId @returns {Promise<HeldMessage[]>} */
  async function readHeld(instanceId) {
    const v = await store.get(`held.${instanceId}`)
    return Array.isArray(v) ? v : []
  }

  /** @param {string} instanceId @param {HeldMessage[]} held */
  async function writeHeld(instanceId, held) {
    await store.set(`held.${instanceId}`, held)
  }

  return { readSeen, remember, readPending, updatePending, readHeld, writeHeld }
}
