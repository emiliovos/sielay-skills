// Encabezado obligatorio en link_send, opt-in con SIELAY_LINK_SEND_HEADERS.
// La variable lista los encabezados separados por «|»; «#k» pide «#» y un número.
// Ej.: SIELAY_LINK_SEND_HEADERS='DECISIÓN #k|AVANCE|ALERTA|DUDA #k'. Vacía o ausente: no se exige nada.

const escape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * @param {string | undefined | null} spec the variable's value
 * @returns {{ labels: string[], re: RegExp } | null} the rule, or null when nothing is required
 */
export function parseSendHeaders(spec) {
  const labels = String(spec ?? '').split('|').map(s => s.trim()).filter(Boolean)
  if (labels.length === 0) return null
  const alts = labels.map(l => escape(l).replace(/\s+/g, '\\s+').replace(/#k/g, '#\\d+'))
  return { labels, re: new RegExp(`^(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'u') }
}

/**
 * @param {string} text the message body
 * @param {{ labels: string[], re: RegExp } | null} rule
 * @returns {string | null} a denial, or null when the first non-empty line starts with a header
 */
export function checkSendHeader(text, rule) {
  if (!rule) return null
  const first = String(text).split('\n').map(l => l.trim()).find(Boolean) ?? ''
  if (rule.re.test(first)) return null
  return `Mensaje sin encabezado: la primera línea debe empezar con ${rule.labels.map(l => `«${l}»`).join(', ')} (#k es un número). Agrégalo y vuelve a mandarlo.`
}
