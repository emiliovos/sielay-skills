// The client's run gate. Pure (no `$`).
//
// A peer's message runs on its own only when the hub said run=1 with gate=auto AND this
// session is in bypassPermissions with a fresh reading, checked at the moment
// of injecting (never from a value cached at poll time). Everything else goes
// to the strip, where only a person's Accept keystroke runs it. A dashboard
// "release" only ever moves a message to the strip; the model has no tool to
// decide or release anything.
//
// One more case runs: run=1 with gate=accepted. The hub sends that only for a
// message a person already accepted in this terminal whose `injected` ack never
// arrived (the lease expired), and keeps redelivering it until it does. It is
// injected as-is, in any mode; the dedupe by id keeps it from running twice.

/**
 * @param {{ delivery: { run?: unknown, gate?: unknown }, mode: { mode?: unknown, fresh?: unknown } }} input
 * @returns {boolean}
 */
export function shouldInject({ delivery, mode }) {
  if (delivery.run !== 1) return false
  if (delivery.gate === 'accepted') return true
  return delivery.gate === 'auto' && mode.mode === 'bypassPermissions' && mode.fresh === true
}

/**
 * The person pressed Accept: that keystroke is the confirmation, so the
 * message is decided `accepted` and injected regardless of the mode.
 *
 * @param {{ id?: string }} _delivery
 * @returns {{ decide: 'accepted', inject: true }}
 */
export function onStripAccept(_delivery) {
  return { decide: 'accepted', inject: true }
}

/**
 * @param {{ id?: string }} _delivery
 * @returns {{ decide: 'rejected', inject: false }}
 */
export function onStripReject(_delivery) {
  return { decide: 'rejected', inject: false }
}
