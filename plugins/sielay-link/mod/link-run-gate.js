// The client's run gate. Pure (no `$`).
//
// A peer's message runs on its own only when the hub said run=1 with gate=auto AND this
// session is in bypassPermissions with a fresh reading, checked at the moment
// of injecting (never from a value cached at poll time). Everything else goes
// to the strip, where only a person's Accept keystroke runs it. A dashboard
// "release" only ever moves a message to the strip; the model has no tool to
// decide or release anything.

/**
 * @param {{ delivery: { run?: unknown, gate?: unknown }, mode: { mode?: unknown, fresh?: unknown } }} input
 * @returns {boolean}
 */
export function shouldInject({ delivery, mode }) {
  return delivery.run === 1 && delivery.gate === 'auto' && mode.mode === 'bypassPermissions' && mode.fresh === true
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
