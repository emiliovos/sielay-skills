// What the link tools answer in words: the hub's refusal codes in Spanish,
// the note after a send and the answer for a conversation that already ended.
// Pure.

import { ADDRESS } from './link-tool-address.js'

/** @type {Record<string, string>} */
export const CODE_MESSAGES = {
  turn_cap: 'La conversación llegó a su tope de turnos. Un admin puede extenderla desde el dashboard; si no, termina aquí.',
  pair_budget: 'Este par agotó su presupuesto de turnos (30 en 6 h). Espera o pide a un admin que lo revise.',
  pair_cooldown: 'Una conversación de este par llegó al tope hace poco: espera 30 min antes de abrir otra.',
  conversation_closed: 'Esa conversación está cerrada. Abre una nueva con link_send si hace falta.',
  not_paired: 'No estás emparejado con esa sesión. Un admin tiene que crear el par.',
  unknown_peer: 'No existe esa dirección. Revisa las disponibles con link_peers.',
  too_large: 'El mensaje pasa de 16 KB. Resúmelo o divídelo.',
  invalid: 'El hub rechazó el mensaje por formato inválido.',
  too_many_sessions: 'Esta máquina ya tiene 16 sesiones en línea, el tope. Cierra una o reusa una sesión (mismo nombre y carpeta), o pide a un admin que revise.',
}

/** Where a 409 link_paused says sielay-link is off (`scope`). */
const PAUSE_SCOPES = Object.freeze({
  person: 'para una de las personas',
  line: 'en la línea entre esas dos máquinas',
  device: 'en una de las dos máquinas',
  session: 'en una de las dos terminales',
})

/**
 * @param {unknown} err
 * @returns {string}
 */
export function describeHubError(err) {
  const e = /** @type {{ kind?: string, code?: string, field?: string, scope?: string, message?: string }} */ (err ?? {})
  if (e.code === 'link_paused') {
    // own keys only: a scope like "toString" never reaches Object.prototype
    const where = e.scope && Object.hasOwn(PAUSE_SCOPES, e.scope) ? PAUSE_SCOPES[/** @type {keyof typeof PAUSE_SCOPES} */ (e.scope)] : 'para esta conversación'
    return `sielay-link está apagado ${where}. Un admin lo prende desde /admin/link o /conexiones; no reintentes.`
  }
  if (e.code === 'invalid' && e.field === 'conversation_id') {
    return 'Esa conversación no es de esta sesión (el hub te ve como otra). Contesta con link_send a la dirección de la otra sesión, sin conversation.'
  }
  if (e.code === 'invalid' && e.field) return `El hub rechazó el campo ${e.field} por formato inválido.`
  const known = e.code ? CODE_MESSAGES[e.code] : undefined
  if (known) return known
  if (e.kind === 'paused') return 'sielay-link está apagado en el hub ahora mismo.'
  if (e.kind === 'unauthorized' || e.kind === 'no_token') return 'El token de sielay-link no sirve. Si acabas de correr /up en esta máquina, corre /reload-plugins (no la des de alta otra vez); si no, conéctala con curl -fsSL <hub>/up | bash, o con /link pair <slot> si un admin te dio un slot.'
  if (e.kind === 'rate_limited') return 'El hub pide esperar (demasiadas peticiones). Intenta en un momento.'
  if (e.kind === 'network') return 'No se pudo contactar al hub de sielay-link.'
  return `sielay-link: ${e.message ?? String(err)}`
}

/** Why a conversation closed, when the hub does not name who closed it. */
const CLOSED_REASONS = Object.freeze({ idle: 'se cerró sola por inactividad', admin: 'la cerró un admin' })

/**
 * A conversation that already ended is not a failure: the answer the model
 * gets says who closed it and that nothing more is needed.
 * @param {{ closedBy?: string, closedReason?: string }} e
 * @returns {string}
 */
export function closedConversationNote(e) {
  const by = typeof e.closedBy === 'string' && ADDRESS.test(e.closedBy) ? `la cerró ${e.closedBy}` : undefined
  const reason = e.closedReason && Object.hasOwn(CLOSED_REASONS, e.closedReason)
    ? CLOSED_REASONS[/** @type {keyof typeof CLOSED_REASONS} */ (e.closedReason)]
    : undefined
  const how = by ?? reason
  return `La conversación ya terminó${how ? `: ${how}` : ''}. No hace falta responder; si quieres seguir, abre otra con link_send.`
}

/**
 * @param {{ gate?: string }} sent
 * @returns {string}
 */
export function noteFor(sent) {
  if (sent.gate === 'held') return 'Mensaje retenido: espera que un admin lo libere a la franja del receptor.'
  return 'Enviado. Si el receptor está en bypass y el par tiene auto-ejecución, corre solo; si no, queda en su franja hasta que una persona lo acepte.'
}

/**
 * The note of one recipient of a multi-send: sent, already ended, or refused
 * in the same words as a single send.
 * @param {Record<string, any>} r
 * @returns {string}
 */
export function resultNote(r) {
  if (r?.ok === true) return noteFor(r)
  if (r?.code === 'conversation_closed') return closedConversationNote({ closedBy: r.closed_by, closedReason: r.closed_reason })
  return describeHubError({ kind: 'http', code: r?.code, field: r?.field, scope: r?.scope, message: `hub answered ${r?.status ?? '?'}` })
}
