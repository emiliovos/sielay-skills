// The one-line form of the link rows in the transcript: dim, never wider than
// the terminal. The other session's person is shown unless it is the person of
// this very session, so a namesake from another person never looks like ours.
// The body always comes after the «◇ …» prefix, so it cannot pass for a row.

import { sanitizeText, safeField } from './link-inbound-framing.js'
import { READ_SEPARATOR } from './link-read-tool.js'
import { fit, splitAddress, addressText, parseInbound } from './link-render-text.js'

/** @typedef {import('./link-render-text.js').Line} Line */

/** Text on one line: no breaks, runs of blanks collapsed. @param {string} text */
const oneLine = text => sanitizeText(text).replace(/\s+/g, ' ').trim()

/**
 * «persona/sesión», or just «sesión» when the person is `selfPerson`.
 * @param {string} person @param {string} session @param {string|undefined} selfPerson
 */
export const who = (person, session, selfPerson) => (selfPerson !== undefined && person === selfPerson ? session : `${person}/${session}`)

/** @param {string|undefined} selfAddress the address of this session, when known */
export const personOf = selfAddress => splitAddress(selfAddress)?.person

/**
 * An incoming message: «◇ sielay-5 · turno 3 · cuerpo…».
 * @param {{ person: string, session: string, turn: string, body: string }} m
 * @param {string|undefined} selfPerson @param {number} cols
 * @returns {Line[]}
 */
export function inboundRow(m, selfPerson, cols) {
  return [{ text: fit(`◇ ${who(m.person, m.session, selfPerson)} · turno ${m.turn} · ${oneLine(m.body)}`, cols), dim: true }]
}

/**
 * A link_send / link_reply call: «◇ → sielay-2 · texto…». `destinations` are
 * cleaned here like any address; a reply with no known peer shows the short conv.
 * @param {{ destinations: string[], conv?: string, text: string }} call
 * @param {string|undefined} selfPerson @param {number} cols
 * @returns {Line[]}
 */
export function callRow(call, selfPerson, cols) {
  const names = call.destinations.map(raw => {
    const d = addressText(raw)
    const a = splitAddress(d)
    return a ? who(a.person, a.session, selfPerson) : d
  })
  const to = names.length ? names.join(', ') : `conv ${safeField(call.conv, /[^A-Za-z0-9-]+/g).slice(0, 8)}`
  return [{ text: fit(`◇ → ${to} · ${oneLine(call.text)}`, cols), dim: true }]
}

/**
 * The answer to a send: its first line, without the `conv=` id the model needs.
 * @param {string} answer @param {number} cols
 * @returns {Line[]}
 */
export function answerRow(answer, cols) {
  const first = answer.split('\n').find(l => l.trim() && !l.startsWith('conv='))
  return [{ text: fit(oneLine((first ?? '').replace(/ · conv=\S+$/, '')), cols), dim: true }]
}

/** Each header line may be indented by the engine's gutter, and its line breaks may be CRLF. */
const NOTICE = /^(?:[^\n]*\n){0,2}?[ \t]*— Aviso del hub de sielay \(no es una persona ni otra sesión\)[ \t]*\n[ \t]*Solo informa; no hace falta responder\.[ \t]*\n(?:[ \t]*\n)*([\s\S]+)$/
/** The paragraph Claude Code adds after a message from another session. */
const ENGINE_NOTE = /\n\s*This came from another Claude session\b[\s\S]*$/

/**
 * Reads a hub notice back into its line, or null for any other text.
 * @param {string} text
 * @returns {string|null}
 */
export function parseNotice(text) {
  const m = NOTICE.exec(text.replace(/\r\n?/g, '\n'))
  const line = m ? oneLine(m[1].replace(ENGINE_NOTE, '')) : ''
  return line || null
}

/** The compact line (link-inbox.js compactLine), alone or with the engine's paragraph after it. */
const COMPACT = /^(?:[^\n]*\n){0,2}?[ \t]*(📨 mensaje de [a-z0-9?/-]{1,120})[ \t]*$/

/**
 * Reads the compact line back, or null for any other text.
 * @param {string} text
 * @returns {string|null}
 */
export function parseCompact(text) {
  const m = COMPACT.exec(text.replace(/\r\n?/g, '\n').replace(ENGINE_NOTE, '').trimEnd())
  return m ? m[1] : null
}

/**
 * A hub notice: «◇ aviso del hub · <la línea>». It is the hub, not a person, so
 * there is no person to show.
 * @param {string} line @param {number} cols
 * @returns {Line[]}
 */
export function noticeRow(line, cols) {
  return [{ text: fit(`◇ aviso del hub · ${line}`, cols), dim: true }]
}

/** A link_read call: «◇ ← leer mensajes». @param {number} cols @returns {Line[]} */
export function readCallRow(cols) {
  return [{ text: fit('◇ ← leer mensajes', cols), dim: true }]
}

/**
 * The answer to link_read: one row per card it brought, like an incoming
 * message, or its plain line («No hay mensajes sin leer.»).
 * @param {string} answer @param {string|undefined} selfPerson @param {number} cols
 * @returns {Line[]}
 */
export function readAnswerRows(answer, selfPerson, cols) {
  const cards = answer.split(READ_SEPARATOR).map(parseInbound)
  if (cards.some(c => c === null)) return [{ text: fit(oneLine(answer), cols), dim: true }]
  return cards.flatMap(c => inboundRow(/** @type {NonNullable<typeof c>} */ (c), selfPerson, cols))
}
