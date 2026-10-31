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
  forbidden: 'Solo una sesión de una persona admin puede vigilar ramas con link_watch.',
  too_many_sessions: 'Esta máquina llegó a su tope de sesiones: 16 en línea a la vez, o más de 200 sesiones nuevas en 7 días. Cierra una, reusa una sesión (mismo nombre y carpeta), o pide a un admin que revise.',
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
const CLOSED_REASONS = Object.freeze({ idle: 'por inactividad', admin: 'por un admin' })

/**
 * A conversation that already ended is not a failure: the answer the model
 * gets says who closed it and that nothing more is needed.
 * @param {{ closedBy?: string, closedReason?: string }} e
 * @returns {string}
 */
export function closedConversationNote(e) {
  const parts = typeof e.closedBy === 'string' && ADDRESS.test(e.closedBy) ? e.closedBy.split('/') : undefined
  const by = parts ? `${parts[0]}/${parts[2]}` : undefined
  const reason = e.closedReason && Object.hasOwn(CLOSED_REASONS, e.closedReason)
    ? CLOSED_REASONS[/** @type {keyof typeof CLOSED_REASONS} */ (e.closedReason)]
    : undefined
  const how = by ? ` por ${by}` : reason ? ` ${reason}` : ''
  return `Ya cerrada${how} · no hace falta responder\npara seguir, abre otra con link_send`
}

/** Seconds in the largest whole unit a person reads at a glance. @param {number} seconds */
const ageWords = seconds => seconds < 60 ? `${seconds} s` : seconds < 3600 ? `${Math.floor(seconds / 60)} min` : `${Math.floor(seconds / 3600)} h`

/**
 * ` hace N h` for a valid mode-reading age, nothing without one.
 * @param {unknown} seconds
 * @returns {string}
 */
const readingAgo = seconds => Number.isInteger(seconds) && Number(seconds) >= 0 ? ` hace ${ageWords(Number(seconds))}` : ''

/**
 * Why the hub expects a send at the receiver's strip (an unknown reason claims nothing).
 * @param {{ reason?: unknown, mode_age_s?: unknown }} forecast
 * @returns {string}
 */
function stripReason(forecast) {
  if (forecast.reason === 'mode_stale') return ` · sin lectura de modo${readingAgo(forecast.mode_age_s)}`
  if (forecast.reason === 'mode_not_auto') return ' · no está en un modo que corra solo'
  if (forecast.reason === 'pair_off') return ' · el par ya no corre solo'
  return ''
}

/**
 * The first line of a send's answer: where it went, which turn of how many,
 * and what happens next (it runs by itself, waits for a person, or is held; an unknown gate claims nothing).
 * @param {{ gate?: string, turn?: unknown, turns_left?: unknown, forecast?: { gate?: unknown, reason?: unknown, mode_age_s?: unknown } }} sent @param {string} to the destination address
 * @returns {string}
 */
export function sentLine(sent, to) {
  const { turn, turns_left: left } = sent
  const turns = Number.isInteger(turn) && Number.isInteger(left) ? ` · turno ${turn} de ${Number(turn) + Number(left)}` : ''
  if (sent.gate === 'held') return `Retenido para ${to}${turns} · espera que un admin lo libere`
  if (sent.gate === 'auto' && sent.forecast?.gate === 'strip') return `Va a la franja de ${to}${turns}${stripReason(sent.forecast)} · espera que una persona lo acepte`
  if (sent.gate === 'auto') return `Enviado a ${to}${turns} · corre solo`
  if (sent.gate === 'strip') return `En la franja de ${to}${turns} · espera que una persona lo acepte`
  return `Enviado a ${to}${turns}`
}

/**
 * The model's answer to one send: the short line and the conversation id in
 * full on the next one (a reply needs it).
 * @param {{ gate?: string, turn?: unknown, turns_left?: unknown, conversation_id?: unknown }} sent @param {string} to
 * @returns {string}
 */
export function sendAnswer(sent, to) {
  const conv = typeof sent.conversation_id === 'string' ? `\nconv=${sent.conversation_id}` : ''
  return `${sentLine(sent, to)}${conv}`
}

/**
 * One line per recipient of a multi-send: sent (with its conv), already ended,
 * or refused in the same words as a single send.
 * @param {Record<string, any>} r
 * @returns {string}
 */
export function resultLine(r) {
  const to = String(r?.to ?? '?')
  if (r?.ok === true) return `${sentLine(r, to)}${typeof r.conversation_id === 'string' ? ` · conv=${r.conversation_id}` : ''}`
  const why = r?.code === 'conversation_closed'
    ? closedConversationNote({ closedBy: r.closed_by, closedReason: r.closed_reason }).split('\n')[0]
    : describeHubError({ kind: 'http', code: r?.code, field: r?.field, scope: r?.scope, message: `hub answered ${r?.status ?? '?'}` })
  return `No enviado a ${to}: ${why}`
}

/** A field a session sets cannot forge another row. @param {unknown} v */
const oneLine = v => String(v).replace(/\s+/g, ' ').trim()

/** A disconnected session says so; a connected one only when its mode reading is not fresh. @param {Record<string, unknown>} p */
const peerFreshness = p => {
  if (p.online === false) return `desconectada, visto ${p.last_seen_at}`
  return p.mode_fresh === false ? `modo sin lectura${readingAgo(p.mode_age_s)}` : null
}

/**
 * One short row per session, not JSON: this answer stays in the context and is read again every turn.
 * @param {string | undefined} self this session's address
 * @param {Array<Record<string, unknown>>} peers already cleaned
 * @param {string} [machine] keep only that machine's sessions (the address's second part)
 * @returns {string}
 */
export function peersText(self, peers, machine) {
  const wanted = machine?.trim()
  const rows = peers
    .filter(p => !wanted || String(p.address).split('/')[1] === wanted)
    .map(p => [p.address, p.state, p.mode, p.project, peerFreshness(p)].filter(Boolean).map(oneLine).join(' · '))
  return [`tu_direccion: ${self ?? 'sin asignar'}`, 'dirección · estado · modo · proyecto', ...rows].join('\n')
}
