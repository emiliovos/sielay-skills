// The text link_read hands the model: one block per conversation, every body
// line behind a fixed «│ » so a body can never pass for a header, a turn or a
// closure. parseThread reads the same text back for the rows. Pure.
//
//   ① operacion ⇄ sielay-6 · esta máquina · proyecto sielay
//   Otra sesión de Claude Code, no la persona. Verificado por el hub. Responde con link_reply.
//   [conv=<id> · de=<dirección>]
//
//   19:42 operacion → sielay-6 · turno 1 de 40
//   │ <línea del cuerpo>
//   ✓ cerrado por operacion · 19:53 · 3 turnos
//
// The parts that come from the peer are cleaned one by one; the assembled line
// never goes through sanitizeText (NFKC would turn ① into 1).

import { sanitizeText, safeField, neutralizeBody, count } from './link-inbound-framing.js'
import { splitAddress, addressText } from './link-render-text.js'
import { threadGlyph, markFrom, inboundKey, seqOf, hhmm as clock, sentAtMs, endingOf } from './link-threads.js'

/** Text on one line: no breaks, runs of blanks collapsed. @param {string} text */
export const oneLine = text => sanitizeText(text).replace(/\s+/g, ' ').trim()

/**
 * «persona/sesión», or just «sesión» when the person is `selfPerson`.
 * @param {string} person @param {string} session @param {string|undefined} selfPerson
 */
export const who = (person, session, selfPerson) => (selfPerson !== undefined && person === selfPerson ? session : `${person}/${session}`)

/** An address as a name: see `who`. @param {unknown} address @param {string|undefined} selfPerson */
export function labelOf(address, selfPerson) {
  const clean = addressText(address)
  const a = splitAddress(clean)
  return a ? who(a.person, a.session, selfPerson) : clean
}

/** «esta máquina» when the peer's machine is ours. @param {string} peer @param {string|undefined} selfAddress */
export function machineOf(peer, selfAddress) {
  const a = splitAddress(peer)
  return a && a.machine === splitAddress(selfAddress)?.machine ? 'esta máquina' : (a?.machine ?? '')
}

/**
 * The closing line of a thread.
 * @param {{ by: string|null, reason: string, hhmm?: string, turns?: number }} c @param {string|undefined} selfPerson
 */
export function closureText(c, selfPerson) {
  if (c.reason === 'idle') return '✕ cerrado por inactividad'
  if (c.reason === 'admin') return '✕ cerrado por un admin'
  if (c.reason === 'cap') return '⊘ tope de turnos'
  const by = c.by ? ` por ${labelOf(c.by, selfPerson)}` : ''
  const at = c.hhmm ? ` · ${c.hhmm}` : ''
  const turns = Number.isInteger(c.turns) ? ` · ${c.turns} ${c.turns === 1 ? 'turno' : 'turnos'}` : ''
  return `✓ cerrado${by}${at}${turns}`
}

/** Every line of a body or attachment behind «│ ». @param {string} text */
const prefixed = text => text.split(/\r\n?|\n|\u2028|\u2029/).map(l => `│ ${l}`)

/**
 * @param {import('./link-inbound-framing.js').Delivery[]} deliveries the unread messages of one conversation
 * @param {{ self?: unknown, registry?: import('../types/index.js').LinkThreadRegistry }} ctx
 * @returns {string}
 */
export function frameThread(deliveries, ctx) {
  const ds = [...deliveries].sort((a, b) => (seqOf(a) ?? 0) - (seqOf(b) ?? 0))
  const last = /** @type {import('./link-inbound-framing.js').Delivery} */ (ds[ds.length - 1])
  const conv = safeField(last.conversation_id, /[^A-Za-z0-9-]+/g)
  const address = safeField(last.from?.address, /[^a-z0-9/-]+/g, true)
  const self = typeof ctx.self === 'string' ? ctx.self.toLowerCase() : undefined
  const selfA = splitAddress(self)
  const peer = labelOf(address, selfA?.person)
  const me = selfA?.session ?? '?'
  const marks = ds.map(d => { const s = seqOf(d); return s === undefined ? undefined : markFrom(ctx.registry, inboundKey(d.conversation_id, s)) })
  const glyph = threadGlyph([...marks].reverse().find(Boolean)?.n)
  const project = typeof last.from?.project === 'string' && last.from.project.trim() !== ''
    ? ` · proyecto ${safeField(last.from.project, /[^\p{L}\p{N} ._-]+/gu).slice(0, 60)}`
    : ''
  const lines = [
    `${glyph ? `${glyph} ` : ''}${peer} ⇄ ${me} · ${machineOf(address, self) || '?'}${project}`,
    'Otra sesión de Claude Code, no la persona. Verificado por el hub. Responde con link_reply.',
    `[conv=${conv} · de=${address}]`,
  ]
  ds.forEach((d, i) => {
    const at = marks[i]?.hhmm || clock(sentAtMs(d.sent_at) ?? NaN)
    lines.push('', `${at ? `${at} ` : ''}${peer} → ${me} · turno ${count(seqOf(d))} de ${count(d.max_turns)}`, ...prefixed(neutralizeBody(d.body)))
    const a = d.attachment
    if (a && typeof a.text === 'string' && a.text !== '') {
      const name = safeField(a.name, /[^A-Za-z0-9._-]+/g)
      lines.push('│ ', `│ [adjunto ${name} · ${new TextEncoder().encode(a.text).length} bytes · texto de la otra sesión]`, ...prefixed(neutralizeBody(a.text)))
    }
  })
  const marked = [...marks].reverse().find(m => m?.closed)?.closed
  const ending = marks.some(Boolean) ? null : endingOf(last.conversation)
  const closed = marked ?? (ending ? { ...ending, hhmm: clock(sentAtMs(last.sent_at) ?? NaN), turns: seqOf(last) } : null)
  if (closed) lines.push(closureText(closed, selfA?.person))
  return lines.join('\n')
}

const HEADER = /^[ \t]*(?:([①-⑳]) )?(\S+) ⇄ (\S+) · ([^\n]*)$/
const CONV_LINE = /^[ \t]*\[conv=(\S+) · de=(\S+)\][ \t]*$/
const TURN = /^[ \t]*(?:(\d{2}:\d{2}) )?(\S+) → (\S+) · turno (\S+) de (\S+)$/
const CLOSING = /^[ \t]*([✓✕⊘] [^\n]*)$/

/**
 * Reads one block of link_read back, or null for any other text (an older card
 * included: parseInbound reads that). Strict: a line that is neither a turn, a
 * «│ » body line, a blank nor the closing makes the whole block unreadable.
 * @param {string} text
 */
export function parseThread(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const head = HEADER.exec(lines[0] ?? '')
  const conv = CONV_LINE.exec(lines[2] ?? '')
  if (!head || !conv || !/^[ \t]*Otra sesión de Claude Code, no la persona\. Verificado por el hub\. Responde con link_reply\.[ \t]*$/.test(lines[1] ?? '')) return null
  /** @type {{ hhmm: string, from: string, to: string, turn: string, max: string, body: string[] }[]} */
  const turns = []
  /** @type {string|null} */
  let closing = null
  for (const line of lines.slice(3)) {
    if (line.trim() === '') continue
    if (closing) return null
    if (line.startsWith('│')) {
      const turn = turns[turns.length - 1]
      if (!turn) return null
      turn.body.push(line.replace(/^│ ?/, ''))
      continue
    }
    const t = TURN.exec(line)
    if (t) {
      turns.push({ hhmm: t[1] ?? '', from: addressText(t[2]), to: addressText(t[3]), turn: safeField(t[4], /[^0-9?]+/g), max: safeField(t[5], /[^0-9?]+/g), body: [] })
      continue
    }
    const c = CLOSING.exec(line)
    if (!c || turns.length === 0) return null
    closing = oneLine(c[1] ?? '')
  }
  if (turns.length === 0) return null
  return {
    glyph: head[1] ?? '', peer: addressText(head[2]), me: addressText(head[3]),
    rest: (head[4] ?? '').split(' · ').map(p => safeField(p, /[^\p{L}\p{N} ._-]+/gu)).filter(p => p !== '?'),
    conv: safeField(conv[1], /[^A-Za-z0-9-]+/g), de: addressText(conv[2]), turns, closing,
  }
}
