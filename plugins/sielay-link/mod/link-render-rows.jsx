// The transcript rows of the link messages (ui.render hooks): the call a model
// makes with link_send / link_reply, its short answer, and a peer's message as
// the person sees it. Only what the person sees changes: the text the model
// reads (the tool result, frameInbound) is untouched. ctrl+o (`isExpanded`)
// shows the whole body, and a message this file cannot read goes to the
// engine's own drawing.

import { columnsOf, sendLines, parseInbound, inboundLines } from './link-render-text.js'
import { inboundRow, callRow, answerRow, personOf } from './link-render-compact.js'

// $.state reference: literal plugin/key, declared in each file that uses it.
const CONVERSATIONS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'conversations' })
const STATUS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'status' })

/** The person of this session, or undefined while its address is not known. @param {Engine} $ */
async function selfPersonOf($) {
  return personOf((await $.state.get(STATUS)).value?.address)
}

/** @typedef {import('claude-code').EngineInterface} Engine */
/** @typedef {import('./link-render-text.js').Line} Line */

/** The tool name as the engine reports it (with or without the mcp prefix). */
const LINK_SEND_OR_REPLY = /(?:^|__)(link_send|link_reply)$/

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
  return tree($, e, callRow(call, await selfPersonOf($), columnsOf(e)))
}

/**
 * The answer under the call: the short line without the `conv=` ids.
 * @param {Engine} $ @param {import('claude-code').RenderInput<'ToolResult'>} e
 * @returns {import('claude-code').RenderElement | null}
 */
export function renderSendAnswer($, e) {
  if (!LINK_SEND_OR_REPLY.test(e.props.tool) || e.props.isErrored || e.props.isExpanded === true) return null
  const text = outputText(e.props.output)
  return text ? tree($, e, answerRow(text, columnsOf(e))) : null
}

/**
 * A peer's message: one dim line, or with ctrl+o the header, the whole body and
 * how to answer. Null for any other row.
 * @param {Engine} $ @param {import('claude-code').RenderInput<'UserMessage'>} e
 * @returns {Promise<import('claude-code').RenderElement | null>}
 */
export async function renderInbound($, e) {
  const parsed = parseInbound(e.props.text)
  if (!parsed) return null
  if (e.props.isExpanded === true) return tree($, e, inboundLines(parsed, columnsOf(e), true))
  return tree($, e, inboundRow(parsed, await selfPersonOf($), columnsOf(e)))
}
