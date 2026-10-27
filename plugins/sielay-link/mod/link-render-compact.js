// The one-line form of the link rows in the transcript: dim, never wider than
// the terminal. The other session's person is shown unless it is the person of
// this very session, so a namesake from another person never looks like ours.
// The body always comes after the «◇ …» prefix, so it cannot pass for a row.

import { safeField } from './link-inbound-framing.js'
import { READ_SEPARATOR } from './link-read-tool.js'
import { fit, splitAddress, addressText, parseInbound } from './link-render-text.js'
import { oneLine, who, parseThread } from './link-thread-text.js'
import { inboundThreadRows, threadCardLines } from './link-thread-rows.js'

export { who }

/** @typedef {import('./link-render-text.js').Line} Line */

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

/**
 * The compact line (link-inbox.js compactLine), alone or after the engine's
 * own first line, with the engine's paragraph after it. Nothing else may come
 * before it: the row hides the text, so any other line must be drawn whole.
 */
const COMPACT = /^(?:[ \t]*Another Claude session sent a message:[ \t]*\n)?[ \t]*(📨 mensaje de [a-z0-9?/-]{1,120})[ \t]*$/

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
 * The answer to link_read: the rows of each conversation it brought (a block
 * of the thread format, or a card of 1.10.x), or its plain line («No hay
 * mensajes sin leer.»).
 * @param {string} answer @param {import('./link-thread-rows.js').RowCtx} ctx @param {number} cols
 * @returns {Line[]}
 */
export function readAnswerRows(answer, ctx, cols) {
  const cards = answer.split(READ_SEPARATOR).map(b => parseThread(b) ?? parseInbound(b))
  if (cards.some(c => c === null)) return [{ text: fit(oneLine(answer), cols), dim: true }]
  return cards.flatMap(c => {
    const card = /** @type {NonNullable<typeof c>} */ (c)
    return 'turns' in card ? inboundThreadRows(card, ctx, cols) : inboundRow(card, personOf(ctx.self), cols)
  })
}

/**
 * ctrl+o on the answer to link_read: every conversation as a card, or null
 * when the answer is not made of thread blocks (the engine draws it).
 * @param {string} answer @param {number} cols
 * @returns {Line[]|null}
 */
export function readAnswerCards(answer, cols) {
  const blocks = answer.split(READ_SEPARATOR).map(parseThread)
  if (blocks.some(b => b === null)) return null
  return blocks.flatMap((b, i) => [...(i > 0 ? [{ text: '  ───', dim: /** @type {const} */ (true) }] : []), ...threadCardLines(/** @type {NonNullable<typeof b>} */ (b), cols)])
}
