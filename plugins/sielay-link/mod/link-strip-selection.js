// Which strip message a person means. Pure (no `$`).
//
// Accept/Reject only ever act on an id the person saw: the band and the pane
// show the first SHORT_ID_LEN characters, and `/link accept|reject|show <id>`
// takes that (or the full id). Nothing is guessed: an ambiguous or unknown id
// is refused. Commands that decide are honoured only from the person's own
// Enter at the prompt (`composer`), never from a plugin, a peer or the SDK.

export const SHORT_ID_LEN = 8

/** @param {string} id */
export function shortId(id) {
  return String(id).slice(0, SHORT_ID_LEN)
}

/**
 * @param {ReadonlyArray<{ id: string }>} strip
 * @param {string} query
 * @returns {{ id: string, error?: undefined } | { error: string, id?: undefined }}
 */
export function resolveStripId(strip, query) {
  const q = String(query ?? '').trim()
  if (!q) return { error: 'Uso: /link accept|reject|show <id> (el id que muestra la franja).' }
  const exact = strip.find(d => d.id === q)
  if (exact) return { id: exact.id }
  if (q.length < SHORT_ID_LEN) return { error: `El id necesita al menos ${SHORT_ID_LEN} caracteres (los que muestra la franja).` }
  const matches = strip.filter(d => d.id.startsWith(q))
  if (matches.length === 1 && matches[0]) return { id: matches[0].id }
  if (matches.length > 1) return { error: 'Ese id coincide con varios mensajes: escribe más caracteres.' }
  return { error: `El mensaje ${q} no está en la franja.` }
}

/**
 * @param {unknown} origin a PromptOrigin
 * @returns {boolean}
 */
export function isPersonOrigin(origin) {
  return Boolean(origin) && /** @type {{ kind?: unknown }} */ (origin).kind === 'composer'
}
