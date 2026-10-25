// What the transcript shows of a link message, as plain lines for a given
// width: pure (no `$`, no elements). link-render-rows.jsx turns the lines into
// a tree. Nothing here is wider than MAX_COLS; real line breaks, never a
// reliance on the terminal's own wrapping.

import { sanitizeText } from './link-inbound-framing.js'

/** The widest line the plugin draws, whatever the terminal measures. */
export const MAX_COLS = 80
const MIN_COLS = 24
/** Lines of a message body shown before «N líneas más». */
export const BODY_LINES = 3
const INDENT = '  '

/**
 * @typedef {{ text: string, dim?: true, color?: string }} Line
 */

/** @param {{ viewport?: { columns?: number } }} e the ui.render envelope @returns {number} */
export function columnsOf(e) {
  const cols = e.viewport?.columns
  return Math.max(MIN_COLS, Math.min(MAX_COLS, Number.isInteger(cols) ? /** @type {number} */ (cols) : MAX_COLS))
}

/**
 * One line cut to `cols` code points, with an ellipsis when it was longer.
 * @param {string} text @param {number} cols
 */
export function fit(text, cols) {
  const chars = Array.from(text)
  return chars.length > cols ? `${chars.slice(0, cols - 1).join('')}…` : text
}

/**
 * Wraps text at word boundaries into lines of at most `cols` code points; a
 * word longer than a line is split. Newlines in the text are kept.
 * @param {string} text @param {number} cols
 * @returns {string[]}
 */
export function wrap(text, cols) {
  /** @type {string[]} */
  const out = []
  for (const raw of sanitizeText(text).replace(/\r\n?/g, '\n').split('\n')) {
    let line = ''
    for (const word of raw.split(/[ \t]+/).filter(Boolean)) {
      let rest = Array.from(word)
      while (rest.length > cols) {
        if (line) out.push(line)
        out.push(rest.slice(0, cols).join(''))
        rest = rest.slice(cols)
        line = ''
      }
      const w = rest.join('')
      if (!line) line = w
      else if (Array.from(line).length + 1 + rest.length <= cols) line += ` ${w}`
      else { out.push(line); line = w }
    }
    out.push(line)
  }
  while (out.length > 1 && out.at(-1) === '') out.pop()
  return out
}

/**
 * The body, indented and fitted to `cols`; unless `expanded`, only the first
 * lines with «N líneas más · ctrl+o para ver todo» after them.
 * @param {string} text @param {number} cols @param {boolean} expanded
 * @returns {Line[]}
 */
export function bodyLines(text, cols, expanded) {
  const lines = wrap(text, cols - INDENT.length)
  const shown = expanded ? lines : lines.slice(0, BODY_LINES)
  /** @type {Line[]} */
  const rows = shown.map(t => ({ text: INDENT + t }))
  const more = lines.length - shown.length
  if (more > 0) rows.push({ text: fit(`${INDENT}${more} ${more === 1 ? 'línea más' : 'líneas más'} · ctrl+o para ver todo`, cols), dim: true })
  return rows
}

/** @param {unknown} address @returns {{ person: string, machine: string, session: string } | null} */
export function splitAddress(address) {
  const m = typeof address === 'string' ? /^([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(address) : null
  return m ? { person: m[1], machine: m[2], session: m[3] } : null
}

/**
 * The call a model made with link_send or link_reply: «● link_send → sesión · máquina»
 * and the text under it.
 * @param {{ tool: string, destinations: string[], conv?: string, text: string, attachment?: string }} call
 * @param {number} cols @param {boolean} expanded
 * @returns {Line[]}
 */
export function sendLines(call, cols, expanded) {
  const names = call.destinations.map(splitAddress)
  const one = names.length === 1 ? names[0] : null
  const where = names.length === 0
    ? `conv ${(call.conv ?? '?').slice(0, 8)}`
    : one ? `${one.session} · ${one.machine}`
      : `${names.length} sesiones: ${names.map((n, i) => n?.session ?? call.destinations[i]).join(', ')}`
  /** @type {Line[]} */
  const rows = [{ text: fit(`● ${call.tool} → ${sanitizeText(where)}`, cols) }]
  rows.push(...bodyLines(call.text, cols, expanded))
  if (call.attachment) rows.push({ text: fit(`${INDENT}+ adjunto ${sanitizeText(call.attachment)}`, cols), dim: true })
  return rows
}

/** The header the framing gives a peer's message (link-inbound-framing.js frameInbound). */
const INBOUND =
  /^— Mensaje de (\S+) desde (\S+(?: \S+)?) \(sesión ([^,)\n]+)(?:, proyecto ([^)\n]+))?\)\nOtra sesión de Claude Code, no la persona\. Verificado por el hub\. Turno (\S+) de (\S+)\.\nResponde con link_reply\.\n\[conv=(\S+) · de=\S+\]\n\n([\s\S]*)$/

/**
 * Reads a framed peer message back into its parts, or null for any other text.
 * @param {string} text
 */
export function parseInbound(text) {
  const m = INBOUND.exec(text)
  if (!m) return null
  const [, , machine, session, project, turn, max, conv, body] = m
  return { machine, session, project, turn, max, conv, body }
}

/**
 * A peer's message as the person sees it: «◆ sesión · máquina · proyecto · turno N/M»,
 * the body under it and how to answer.
 * @param {NonNullable<ReturnType<typeof parseInbound>>} m @param {number} cols @param {boolean} expanded
 * @returns {Line[]}
 */
export function inboundLines(m, cols, expanded) {
  const parts = [m.session, m.machine, ...(m.project ? [m.project] : []), `turno ${m.turn}/${m.max}`]
  return [
    { text: fit(`◆ ${parts.join(' · ')}`, cols) },
    ...bodyLines(m.body, cols, expanded),
    { text: fit(`${INDENT}↩ link_reply · conv ${m.conv.slice(0, 8)}…`, cols), dim: true },
  ]
}

/**
 * What the person sees of a link_send / link_reply answer: every line but the
 * `conv=` ones (the model needs the id, the person has the short one above).
 * @param {string} answer @param {number} cols
 * @returns {Line[]}
 */
export function answerLines(answer, cols) {
  const kept = answer.split('\n').filter(l => !l.startsWith('conv=')).map(l => l.replace(/ · conv=\S+$/, ''))
  return kept.flatMap(l => wrap(l, cols - INDENT.length)).map(t => ({ text: INDENT + t, dim: true }))
}
