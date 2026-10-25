// The one-line form of the link rows in the transcript: dim, never wider than
// the terminal. The other session's person is shown unless it is the person of
// this very session, so a namesake from another person never looks like ours.
// The body always comes after the «◇ …» prefix, so it cannot pass for a row.

import { sanitizeText, safeField } from './link-inbound-framing.js'
import { fit, splitAddress, addressText } from './link-render-text.js'

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
