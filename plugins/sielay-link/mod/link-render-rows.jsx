// The transcript rows of the link messages (ui.render hooks): the call a model
// makes with link_send / link_reply, its short answer, and a peer's message as
// the person sees it. Only what the person sees changes: the text the model
// reads (the tool result, frameInbound) is untouched. ctrl+o (`isExpanded`)
// shows the whole body, and a message this file cannot read goes to the
// engine's own drawing.

import { columnsOf, sendLines, parseInbound, inboundLines, fit } from './link-render-text.js'
import { inboundRow, callRow, answerRow, personOf, parseNotice, noticeRow, readCallRow, readAnswerRows, readAnswerCards, parseCompact } from './link-render-compact.js'
import { outboundTurnRows, outboundAnswerRows } from './link-thread-rows.js'
import { markFrom } from './link-threads.js'

// $.state reference: literal plugin/key, declared in each file that uses it.
const CONVERSATIONS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'conversations' })
const STATUS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'status' })
const THREADS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'threads' })

/** This session's address and its thread registry: what the thread rows read. @param {Engine} $ */
async function threadCtx($) {
  return { self: (await $.state.get(STATUS)).value?.address, registry: (await $.state.get(THREADS)).value }
}

/** The person of this session, or undefined while its address is not known. @param {Engine} $ */
async function selfPersonOf($) {
  return personOf((await $.state.get(STATUS)).value?.address)
}

/** @typedef {import('claude-code').EngineInterface} Engine */
/** @typedef {import('./link-render-text.js').Line} Line */

/** The tool name as the engine reports it (with or without the mcp prefix). */
const LINK_SEND_OR_REPLY = /(?:^|__)(link_send|link_reply)$/
const LINK_READ = /(?:^|__)link_read$/

/**
 * @param {Engine} $ @param {{ surface: any, component: any }} e @param {Line[]} lines
 */
function tree($, e, lines) {
  const { Box, Text } = $.ui.resolve(/** @type {any} */ (e))
  return (
    <Box flexDirection="column">
      {lines.map(l => (
        l.bar ? (
          <Box>
            <Text dimColor>{'  │ '}</Text>
            <Text>{l.text}</Text>
          </Box>
        ) : (
          <Text dimColor={l.dim} color={l.color}>{l.text}</Text>
        )
      ))}
    </Box>
  )
}

/** @param {unknown} output the stored result of a plugin tool @returns {string|null} */
export function outputText(output) {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) return output.map(b => (typeof b?.text === 'string' ? b.text : '')).join('\n')
  const o = /** @type {{ text?: unknown, content?: unknown }|null} */ (output)
  if (typeof o?.text === 'string') return o.text
  return o && Array.isArray(o.content) ? outputText(o.content) : null
}

/**
 * The call's row for link_send / link_reply; null leaves it to the engine.
 * @param {Engine} $ @param {import('claude-code').RenderInput<'ToolUse'>} e
 * @returns {Promise<import('claude-code').RenderElement | null>}
 */
export async function renderSendCall($, e) {
  if (LINK_READ.test(e.props.tool)) return e.props.isExpanded === true ? null : tree($, e, readCallRow(columnsOf(e)))
  const tool = LINK_SEND_OR_REPLY.exec(e.props.tool)?.[1]
  const input = /** @type {Record<string, unknown>|null} */ (e.props.input)
  if (!tool || !input || typeof input.text !== 'string') return null
  const conv = typeof input.conversation === 'string' ? input.conversation : undefined
  let destinations = Array.isArray(input.to) ? input.to : typeof input.to === 'string' ? [input.to] : []
  if (destinations.length === 0 && conv) {
    const peer = (await $.state.get(CONVERSATIONS)).value?.[conv]
    if (peer) destinations = [peer]
  }
  const attachment = /** @type {{ name?: unknown }|undefined} */ (input.attachment)?.name
  const call = { tool, destinations: destinations.map(String), conv, text: input.text, attachment: typeof attachment === 'string' ? attachment : undefined }
  if (e.props.isExpanded === true) return tree($, e, sendLines(call, columnsOf(e), true))
  if (call.destinations.length > 1) return tree($, e, callRow(call, await selfPersonOf($), columnsOf(e)))
  const ctx = await threadCtx($)
  return tree($, e, outboundTurnRows(call, markFrom(ctx.registry, e.props.tool_use_id), ctx, columnsOf(e)))
}

/**
 * The answer under the call: the short line without the `conv=` ids.
 * @param {Engine} $ @param {import('claude-code').RenderInput<'ToolResult'>} e
 * @returns {Promise<import('claude-code').RenderElement | null>}
 */
export async function renderSendAnswer($, e) {
  if (LINK_READ.test(e.props.tool)) {
    if (e.props.isErrored) return null
    const read = outputText(e.props.output)
    if (!read) return null
    if (e.props.isExpanded === true) {
      const cards = readAnswerCards(read, columnsOf(e))
      return cards ? tree($, e, cards) : null
    }
    return tree($, e, readAnswerRows(read, await threadCtx($), columnsOf(e)))
  }
  if (!LINK_SEND_OR_REPLY.test(e.props.tool) || e.props.isErrored || e.props.isExpanded === true) return null
  const text = outputText(e.props.output)
  if (!text) return null
  const ctx = await threadCtx($)
  const mark = markFrom(ctx.registry, e.props.tool_use_id)
  const rows = mark ? outboundAnswerRows(mark, ctx, columnsOf(e)) : null
  return tree($, e, rows ?? answerRow(text, columnsOf(e)))
}

/**
 * A peer's message or a hub notice: one dim line (the engine's own row with ctrl+o for a notice), or with ctrl+o the header, the whole body and
 * how to answer. Null for any other row.
 * @param {Engine} $ @param {import('claude-code').RenderInput<'UserMessage'>} e
 * @returns {Promise<import('claude-code').RenderElement | null>}
 */
export async function renderInbound($, e) {
  const parsed = parseInbound(e.props.text)
  if (!parsed) {
    if (e.props.isExpanded === true) return null
    const notice = parseNotice(e.props.text)
    if (notice) return tree($, e, noticeRow(notice, columnsOf(e)))
    const compact = parseCompact(e.props.text)
    return compact ? tree($, e, [{ text: fit(`◇ ${compact}`, columnsOf(e)), dim: true }]) : null
  }
  if (e.props.isExpanded === true) return tree($, e, inboundLines(parsed, columnsOf(e), true))
  return tree($, e, inboundRow(parsed, await selfPersonOf($), columnsOf(e)))
}
