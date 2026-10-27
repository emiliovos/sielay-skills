// What the transcript shows of a link message, as plain lines for a given
// width: pure (no `$`, no elements). link-render-rows.jsx turns the lines into
// a tree. Nothing here is wider than MAX_COLS; real line breaks, never a
// reliance on the terminal's own wrapping.

import { sanitizeText, safeField } from './link-inbound-framing.js'

/** The widest line the plugin draws, whatever the terminal measures. */
export const MAX_COLS = 80
const MIN_COLS = 24
/** Lines of a message body shown before «N líneas más». */
export const BODY_LINES = 3
const INDENT = '  '
/** The bar before a body line is drawn as «  │ »: indent, bar, space. */
const BAR = '  │ '

/**
 * @typedef {{ text: string, dim?: true, color?: string, bar?: true }} Line
 * A `bar` line is a message body: the row draws a dim «│ » before it.
 */

/** @param {{ viewport?: { columns?: number } }} e the ui.render envelope @returns {number} */
export function columnsOf(e) {
  const cols = e.viewport?.columns
  return Math.max(MIN_COLS, Math.min(MAX_COLS, Number.isInteger(cols) ? /** @type {number} */ (cols) : MAX_COLS))
}

/** Emoji and East Asian wide characters take two terminal columns; erring wide only cuts sooner. */
const WIDE = /[\p{Extended_Pictographic}\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u
/** Columns a character takes. @param {string} ch */
const colsOfChar = ch => (WIDE.test(ch) ? 2 : 1)
/** Columns a text takes in the terminal. @param {string} text */
export const width = text => Array.from(text).reduce((n, ch) => n + colsOfChar(ch), 0)

/** The longest head of `chars` that fits in `cols` columns. @param {string[]} chars @param {number} cols */
function head(chars, cols) {
  let used = 0
  let i = 0
  while (i < chars.length && used + colsOfChar(chars[i]) <= cols) used += colsOfChar(chars[i++])
  return i
}

/**
 * One line cut to `cols` columns, with an ellipsis when it was wider: a line
 * the terminal would wrap could paint a row of ours from a peer's text.
 * @param {string} text @param {number} cols
 */
export function fit(text, cols) {
  if (width(text) <= cols) return text
  const chars = Array.from(text)
  return `${chars.slice(0, head(chars, cols - 1)).join('')}…`
}

/**
 * Wraps text at word boundaries into lines of at most `cols` columns; a
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
      while (width(rest.join('')) > cols) {
        if (line) out.push(line)
        const n = Math.max(1, head(rest, cols))
        out.push(rest.slice(0, n).join(''))
        rest = rest.slice(n)
        line = ''
      }
      const w = rest.join('')
      if (!line) line = w
      else if (width(line) + 1 + width(w) <= cols) line += ` ${w}`
      else { out.push(line); line = w }
    }
    out.push(line)
  }
  while (out.length > 1 && out.at(-1) === '') out.pop()
  return out
}

/**
 * The body behind a dim bar, fitted to `cols`; unless `expanded`, only the
 * first lines with «N líneas más · ctrl+o para ver todo» after them. The bar
 * keeps a body that opens with «◆» or «↩» from passing for a row of ours.
 * @param {string} text @param {number} cols @param {boolean} expanded
 * @returns {Line[]}
 */
export function bodyLines(text, cols, expanded) {
  const lines = wrap(text, cols - BAR.length)
  const shown = expanded ? lines : lines.slice(0, BODY_LINES)
  /** @type {Line[]} */
  const rows = shown.map(t => ({ text: t, bar: true }))
  const more = lines.length - shown.length
  if (more > 0) rows.push({ text: fit(`${INDENT}${more} ${more === 1 ? 'línea más' : 'líneas más'} · ctrl+o para ver todo`, cols), dim: true })
  return rows
}

/**
 * A header line where the person is never the part that gets cut: `lead`
 * stays whole and, when the line is too wide, the parts named in `cutOrder`
 * (indexes into `parts`, least important first) shrink to «…» or are dropped.
 * @param {string} lead @param {string[]} parts in display order @param {number} cols
 * @param {number[]} [cutOrder]
 */
export function headLine(lead, parts, cols, cutOrder = []) {
  const shown = [...parts]
  const render = () => lead + shown.filter(Boolean).map(p => ` · ${p}`).join('')
  for (const i of cutOrder) {
    const over = width(render()) - cols
    if (over <= 0) break
    const chars = Array.from(shown[i])
    const keep = width(shown[i]) - over - 1
    shown[i] = keep >= 3 ? `${chars.slice(0, head(chars, keep)).join('')}…` : ''
  }
  return fit(render(), cols)
}

/** An address as it is shown: the same characters the hub allows, anything else a dash. @param {unknown} v */
export const addressText = v => safeField(v, /[^a-z0-9/-]+/g, true)

/** @param {unknown} address @returns {{ person: string, machine: string, session: string } | null} */
export function splitAddress(address) {
  const m = typeof address === 'string' ? /^([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(address) : null
  return m ? { person: m[1], machine: m[2], session: m[3] } : null
}

/**
 * The call a model made with link_send or link_reply: «● link_send → persona/sesión · máquina»
 * and the text under it. Everything painted from the call's input is cleaned
 * the way frameInbound cleans an address or a conversation id.
 * @param {{ tool: string, destinations: string[], conv?: string, text: string, attachment?: string }} call
 * @param {number} cols @param {boolean} expanded
 * @returns {Line[]}
 */
export function sendLines(call, cols, expanded) {
  const dests = call.destinations.map(addressText)
  const names = dests.map(splitAddress)
  const first = names[0]
  const lead = `● ${call.tool} →`
  /** @type {string} */
  let head
  if (dests.length === 0) head = headLine(`${lead} conv ${safeField(call.conv, /[^A-Za-z0-9-]+/g).slice(0, 8)}`, [], cols)
  else if (dests.length === 1) head = headLine(`${lead} ${first ? `${first.person}/${first.session}` : dests[0]}`, [first?.machine ?? ''], cols, [0])
  else head = fit(`${lead} ${dests.length} sesiones: ${dests.map((d, i) => (names[i] ? `${names[i]?.person}/${names[i]?.session}` : d)).join(', ')}`, cols)
  /** @type {Line[]} */
  const rows = [{ text: head }]
  rows.push(...bodyLines(call.text, cols, expanded))
  if (call.attachment) rows.push({ text: fit(`${INDENT}+ adjunto ${safeField(call.attachment, /[^A-Za-z0-9._-]+/g)}`, cols), dim: true })
  return rows
}

/** Each header line may be indented by the engine's gutter, and its line breaks may be CRLF. */
const INBOUND = new RegExp(
  '^(?:[^\\n]*\\n){0,2}?[ \\t]*— Mensaje de (\\S+) desde (\\S+(?: \\S+)?) \\(sesión ([^,)\\n]+)(?:, proyecto ([^)\\n]+))?\\)[ \\t]*\\n' +
  '[ \\t]*Otra sesión de Claude Code, no la persona\\. Verificado por el hub\\. Turno (\\S+) de (\\S+?)\\.[ \\t]*\\n' +
  '(?:[ \\t]*Responde con link_reply\\.[ \\t]*\\n)?' +
  '[ \\t]*\\[conv=(\\S+) · de=\\S+\\][ \\t]*(?:\\n|$)([\\s\\S]*)$',
)
/** The paragraph Claude Code adds after a message from another session. */
const ENGINE_NOTE = /\n\s*This came from another Claude session\b[\s\S]*$/

/**
 * Reads a framed peer message back into its parts, or null for any other text.
 * Tolerant of what the engine does around it: line endings, a gutter indent,
 * a missing blank line before the body and the paragraph it appends after it.
 * @param {string} text
 */
export function parseInbound(text) {
  const m = INBOUND.exec(text.replace(/\r\n?/g, '\n'))
  if (!m) return null
  const [, person, machine, session, project, turn, max, conv, rest] = m
  return {
    person: addressText(person), machine: safeField(machine, /[^\p{L}\p{N} -]+/gu), session: addressText(session),
    project: project ? safeField(project, /[^\p{L}\p{N} ._-]+/gu).slice(0, 60) : undefined,
    turn: safeField(turn, /[^0-9?]+/g), max: safeField(max, /[^0-9?]+/g), conv: safeField(conv, /[^A-Za-z0-9-]+/g),
    body: rest.replace(ENGINE_NOTE, '').replace(/^(?:[ \t]*\n)+/, '').trimEnd(),
  }
}

/**
 * A peer's message as the person sees it: «◆ persona/sesión · máquina · proyecto · turno N/M»,
 * the body behind a bar and how to answer.
 * @param {NonNullable<ReturnType<typeof parseInbound>>} m @param {number} cols @param {boolean} expanded
 * @returns {Line[]}
 */
export function inboundLines(m, cols, expanded) {
  return [
    { text: headLine(`◆ ${m.person}/${m.session}`, [m.machine, m.project ?? '', `turno ${m.turn}/${m.max}`], cols, [1, 0]) },
    ...bodyLines(m.body, cols, expanded),
    { text: fit(`${INDENT}↩ link_reply · conv ${m.conv.slice(0, 8)}…`, cols), dim: true },
  ]
}
