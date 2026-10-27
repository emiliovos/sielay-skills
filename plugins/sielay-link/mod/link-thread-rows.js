// The transcript rows of a thread (formato A): the header «① A ⇄ B · máquina ·
// proyecto» on a thread's first turn, then one indented row per turn, and the
// closure or state under it. The number in the margin, the clock time and
// whether the header shows were fixed when the event happened (link-threads.js);
// these functions only read them, so drawing a row again changes nothing. A
// turn with no mark (state lost, mark pruned) gets an indented row without a
// number. Pure; none of the lines is wider than `cols`.

import { fit, headLine, bodyLines, splitAddress } from './link-render-text.js'
import { threadGlyph, markFrom, inboundKey } from './link-threads.js'
import { oneLine, labelOf, machineOf, closureText } from './link-thread-text.js'

/**
 * @typedef {import('./link-render-text.js').Line} Line
 * @typedef {import('../types/index.js').LinkThreadMark} Mark
 * @typedef {{ self?: string, registry?: import('../types/index.js').LinkThreadRegistry }} RowCtx this session's address and the thread registry
 */

/** @param {RowCtx} ctx */
const selfPersonOf = ctx => splitAddress(ctx.self)?.person
/** @param {RowCtx} ctx */
const selfNameOf = ctx => splitAddress(ctx.self)?.session ?? '?'
/** The margin of a row: the thread's number when another thread was open, else blank. @param {Mark} m */
const marginOf = m => (m.crossed && threadGlyph(m.n) ? `${threadGlyph(m.n)}  ` : '   ')
/** @param {string} text @param {number} cols @returns {Line} */
const dim = (text, cols) => ({ text: fit(text, cols), dim: true })

/** @param {Mark} m @param {RowCtx} ctx @param {number} cols @returns {Line} */
function headerRow(m, ctx, cols) {
  const g = threadGlyph(m.n)
  const lead = `${g ? `${g} ` : ''}${labelOf(m.peer, selfPersonOf(ctx))} ⇄ ${selfNameOf(ctx)}`
  return { text: headLine(lead, [machineOf(m.peer, ctx.self), m.project ? `proyecto ${m.project}` : ''], cols, [1, 0]), dim: true }
}

/** @param {string} at @param {string} from @param {string} to @param {string} text */
const turnText = (at, from, to, text) => `${at ? `${at}  ` : ''}${from} → ${to} · ${oneLine(text)}`

/** The closure or state rows under a turn, from its mark. @param {Mark} m @param {RowCtx} ctx @param {number} cols @returns {Line[]} */
function afterRows(m, ctx, cols) {
  /** @type {Line[]} */
  const rows = []
  if (m.state === 'strip') rows.push(dim(`${marginOf(m)}⏸ en la franja de ${labelOf(m.peer, selfPersonOf(ctx))}`, cols))
  if (m.state === 'held') rows.push(dim(`${marginOf(m)}⧗ retenido por un admin`, cols))
  if (m.closed) rows.push(dim(`${marginOf(m)}${closureText(m.closed, selfPersonOf(ctx))}`, cols))
  return rows
}

/**
 * The rows of what link_read brought for one conversation.
 * @param {NonNullable<ReturnType<typeof import('./link-thread-text.js').parseThread>>} block
 * @param {RowCtx} ctx @param {number} cols
 * @returns {Line[]}
 */
export function inboundThreadRows(block, ctx, cols) {
  /** @type {Line[]} */
  const rows = []
  let closed = false
  for (const t of block.turns) {
    const text = t.body.join(' ')
    const m = markFrom(ctx.registry, inboundKey(block.conv, Number(t.turn)))
    if (!m) {
      rows.push(dim(`   ${turnText(t.hhmm, t.from, t.to, text)}`, cols))
      continue
    }
    if (m.first) rows.push(headerRow(m, ctx, cols))
    rows.push(dim(`${marginOf(m)}${turnText(m.hhmm, t.from, t.to, text)}`, cols))
    if (m.closed) closed = true
    rows.push(...afterRows(m, ctx, cols))
  }
  if (block.closing && !closed) rows.push(dim(`   ${block.closing}`, cols))
  return rows
}

/**
 * ctrl+o on link_read: the whole conversation as a card.
 * @param {NonNullable<ReturnType<typeof import('./link-thread-text.js').parseThread>>} block
 * @param {number} cols
 * @returns {Line[]}
 */
export function threadCardLines(block, cols) {
  const short = block.conv.slice(0, 8)
  /** @type {Line[]} */
  const lines = [
    { text: headLine(`${block.glyph ? `${block.glyph} ` : ''}${block.peer} ⇄ ${block.me}`, block.rest, cols, [1, 0]) },
    dim(`   conv ${short} · verificado por el hub · otra sesión, no la persona`, cols),
  ]
  for (const t of block.turns) {
    lines.push({ text: '' }, dim(`   ${t.hhmm ? `${t.hhmm}  ` : ''}${t.from} → ${t.to} · turno ${t.turn} de ${t.max}`, cols), ...bodyLines(t.body.join('\n'), cols, true))
  }
  if (block.closing) lines.push(dim(`   ${block.closing}`, cols))
  lines.push({ text: '' }, dim(`   ↩ responde con link_reply · conv ${short}…`, cols))
  return lines
}

/**
 * The call row of a message we send: the header on the thread's first turn and
 * the turn. With no mark yet (the call is still running, or the state is gone)
 * the turn is drawn indented, with no hour and no number.
 * @param {{ destinations: string[], conv?: string, text: string }} call
 * @param {Mark|undefined} m @param {RowCtx} ctx @param {number} cols
 * @returns {Line[]}
 */
export function outboundTurnRows(call, m, ctx, cols) {
  const peer = m?.peer ?? call.destinations[0] ?? ''
  const to = peer ? labelOf(peer, selfPersonOf(ctx)) : `conv ${(call.conv ?? '?').slice(0, 8)}`
  if (!m) return [dim(`   ${turnText('', selfNameOf(ctx), to, call.text)}`, cols)]
  return [...(m.first ? [headerRow(m, ctx, cols)] : []), dim(`${marginOf(m)}${turnText(m.hhmm, selfNameOf(ctx), to, call.text)}`, cols)]
}

/**
 * The answer row of a message we sent: its state (waits in the other side's
 * strip, held) and the closure, or nothing when it simply runs. Null when the
 * mark has nothing of its own to say (the caller draws the short answer).
 * @param {Mark} m @param {RowCtx} ctx @param {number} cols
 * @returns {Line[]|null}
 */
export function outboundAnswerRows(m, ctx, cols) {
  if (m.refused && !m.closed) return null
  return afterRows(m, ctx, cols)
}
