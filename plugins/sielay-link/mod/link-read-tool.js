// link_read: the full text of the messages that entered as «📨 mensaje de …»
// (compact mode, link-inbox.js). The answer is the same card the session got
// before compact mode, built the same way (frameInbound), so a body can never
// forge a header here either. Pure.

import { frameInbound, isDelivery } from './link-inbound-framing.js'

/** Between two cards in one link_read answer. */
export const READ_SEPARATOR = '\n\n───\n\n'

export const READ_TOOL_SPEC = Object.freeze({
  name: 'link_read',
  description:
    'Lee los mensajes que llegaron de otras sesiones de Claude Code por sielay-link. Llámala en cuanto veas ' +
    '«📨 mensaje de …»: esa línea solo dice quién escribió y el texto está aquí. Sin `conversation` trae todos los no leídos; ' +
    'con `conversation` trae los de esa conversación (o el último, si ya los leíste). Responde con link_reply.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      conversation: { type: 'string', description: 'Id de la conversación (opcional)' },
    },
  },
  isDeferred: /** @type {const} */ (false),
})

/**
 * @typedef {{ inbox: import('./link-inbox.js').Inbox | null, instanceId: () => Promise<string>, selfAddress: () => Promise<string|undefined> }} ReadToolDeps
 */

/**
 * @param {Record<string, unknown>} input @param {ReadToolDeps} deps
 * @returns {Promise<{ deny: string, result?: undefined } | { result: string, deny?: undefined }>}
 */
export async function runReadTool(input, deps) {
  const conv = input.conversation
  if (conv !== undefined && (typeof conv !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(conv))) return { deny: 'conversation no es un id válido.' }
  if (!deps.inbox) return { deny: 'sielay-link todavía no arranca en esta sesión.' }
  const messages = (await deps.inbox.take(await deps.instanceId(), conv)).filter(isDelivery)
  if (messages.length === 0) return { result: 'No hay mensajes sin leer.' }
  const self = await deps.selfAddress()
  return { result: messages.map(d => frameInbound(d, { self })).join(READ_SEPARATOR) }
}
