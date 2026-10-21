// Discovery: the one line that tells a new conversation its own sielay-link
// address and that link_peers lists who it can write to. Pure (no `$`): the
// mod reads the status and the runtime and passes the values in.

const ADDRESS = /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/
const PREFIX = /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/

const HEAD = '[sielay-link] Esta sesión está conectada a sielay-link'
const TAIL =
  'Si te piden hablar con otra sesión de Claude Code (otra máquina u otra terminal), ' +
  'usa link_peers para ver a quién puedes escribir y link_send para escribirle.'

/**
 * Values that come from the hub only count when they have the address shape,
 * so nothing else can reach the model's context through them.
 * @param {unknown} v @returns {v is string}
 */
export function isAddress(v) {
  return typeof v === 'string' && ADDRESS.test(v)
}

/** @param {unknown} v @returns {v is string} */
export function isAddressPrefix(v) {
  return typeof v === 'string' && PREFIX.test(v)
}

/**
 * The frozen discovery text: with the address, with only its prefix, or with neither.
 * @param {{ address?: unknown, addressPrefix?: unknown }} known
 * @returns {string|null}
 */
export function discoveryContext({ address, addressPrefix }) {
  if (isAddress(address)) return `${HEAD} y su dirección es ${address}. ${TAIL}`
  if (isAddressPrefix(addressPrefix)) {
    return `${HEAD} y su dirección empieza con ${addressPrefix}/ (se confirma en el primer contacto con el hub). ${TAIL}`
  }
  return `${HEAD}. ${TAIL}`
}

/**
 * What one `prompt.submit` gets: the text once per conversation, or null.
 * Null leaves the conversation unmarked, so the next prompt tries again: no
 * token yet, sielay-link off, no address or prefix known yet, the plugin's own
 * prompt, or a slash command (its line may never reach the model).
 * @param {{
 *   announced: boolean, connected: boolean, off: boolean, ownPrompt: boolean, command: boolean,
 *   address?: unknown, addressPrefix?: unknown,
 * }} s
 * @returns {string|null}
 */
export function discoveryFor(s) {
  if (s.announced || !s.connected || s.off || s.ownPrompt || s.command) return null
  if (!isAddress(s.address) && !isAddressPrefix(s.addressPrefix)) return null
  return discoveryContext(s)
}

/**
 * `self.address_prefix` from a `GET /api/link/peers` answer; null from a hub
 * that does not send it (before 1.2.0) or sends something else.
 * @param {unknown} answer @returns {string|null}
 */
export function selfPrefixOf(answer) {
  const self = /** @type {{ self?: { address_prefix?: unknown } } | null | undefined} */ (answer)?.self
  return isAddressPrefix(self?.address_prefix) ? self.address_prefix : null
}

/**
 * This session's own address for link_peers and `/link peers`: the one the
 * last poll assigned; else the hub's prefix plus the resolved session name;
 * else null. The name is read only when it is needed.
 * @param {{ address?: unknown, addressPrefix?: unknown, sessionName: () => Promise<unknown> }} s
 * @returns {Promise<string|null>}
 */
export async function ownAddress({ address, addressPrefix, sessionName }) {
  if (isAddress(address)) return address
  if (!isAddressPrefix(addressPrefix)) return null
  const composed = `${addressPrefix}/${await sessionName()}`
  return isAddress(composed) ? composed : null
}
