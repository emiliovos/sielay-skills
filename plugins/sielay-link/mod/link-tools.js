// The tools the model gets: link_send, link_reply, link_peers, and
// link_build_stage, which only reports a build's progress (link-build-tool.js).
// There is deliberately no tool to decide, accept or release a message: only a
// person at the terminal (strip) or an admin with 2FA (dashboard) can.
// Pure (no `$`): the mod passes the hub client and session readers in.

import { normalizeName } from './link-session-name-resolution.js'
import { neutralizeBody } from './link-inbound-framing.js'
import { BUILD_TOOL_SPEC, runBuildTool } from './link-build-tool.js'
import { ownAddress, selfPrefixOf } from './link-discovery-context.js'
import { ADDRESS } from './link-tool-address.js'
import { CODE_MESSAGES, describeHubError, closedConversationNote, noteFor, resultNote } from './link-tool-messages.js'

export { describeHubError, closedConversationNote }

const MAX_BODY_BYTES = 16 * 1024
/** The hub's cap for `to` as a list (one conversation per address). */
const MAX_RECIPIENTS = 10

/** @type {ReadonlyArray<{ name: string, description: string, inputSchema: Record<string, unknown>, isDeferred: false }>} */
export const LINK_TOOL_SPECS = Object.freeze([
  {
    name: 'link_send',
    description:
      'Envía un mensaje a otra sesión de Claude Code emparejada por sielay-link (dirección persona/máquina/sesión; ' +
      'usa link_peers para verlas). Abre una conversación nueva salvo que pases `conversation`. Con `to` como lista ' +
      `(hasta ${MAX_RECIPIENTS} direcciones, sin conversation) abre una conversación con cada una y responde un resultado por destino. ` +
      'El hub decide si el receptor lo ejecuta solo o lo deja en su franja para que una persona lo acepte.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['to', 'text'],
      properties: {
        to: {
          anyOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_RECIPIENTS },
          ],
          description: 'Dirección destino persona/máquina/sesión, o una lista de hasta 10',
        },
        text: { type: 'string', description: 'Texto del mensaje (máximo 16 KB)' },
        conversation: { type: 'string', description: 'Id de una conversación existente (opcional)' },
      },
    },
    isDeferred: false,
  },
  {
    name: 'link_reply',
    description:
      'Responde en una conversación de sielay-link que llegó con el encabezado [sielay-link de=… conv=…]. ' +
      'Usa el valor de conv como `conversation`. Pon end=true para cerrar la conversación.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['conversation', 'text'],
      properties: {
        conversation: { type: 'string', description: 'El conv= del encabezado' },
        text: { type: 'string', description: 'Texto de la respuesta (máximo 16 KB)' },
        end: { type: 'boolean', description: 'Cierra la conversación después de esta respuesta' },
      },
    },
    isDeferred: false,
  },
  {
    name: 'link_peers',
    description:
      'Lista las sesiones de Claude Code con las que esta sesión puede hablar por sielay-link (las de tus máquinas y las de ' +
      'máquinas conectadas) y tu propia dirección. Úsala antes de link_send cuando te pidan escribirle a otra sesión.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        online_only: { type: 'boolean', description: 'Solo las sesiones en línea, de la más activa a la menos (por defecto). false trae también las desconectadas' },
      },
    },
    isDeferred: false,
  },
  BUILD_TOOL_SPEC,
])


/** @param {unknown} raw @returns {string} the address normalized, or '' */
const toAddress = raw => (typeof raw === 'string' ? raw.split('/').map(normalizeName).join('/') : '')

/**
 * @param {unknown} text
 * @returns {string|null} an error, or null when valid
 */
function checkText(text) {
  if (typeof text !== 'string' || text.trim() === '') return 'El texto no puede ir vacío.'
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return CODE_MESSAGES.too_large ?? 'too large'
  return null
}

/**
 * @param {unknown} id
 * @returns {id is string}
 */
function isConvId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(id)
}

/**
 * @typedef {{
 *   client: { send: (b: object) => Promise<any>, peers: (o?: { onlineOnly?: boolean }) => Promise<any> } | null,
 *   sessionFrom: () => Promise<Record<string, unknown>>,
 *   conversationPeer: (id: string) => Promise<string|undefined>,
 *   rememberConversation: (id: string, address: string) => Promise<void>,
 *   newId: () => string,
 *   selfAddress: () => Promise<unknown>,
 *   notePrefix?: (prefix: string) => void,
 *   build?: import('./link-build-tool.js').BuildToolDeps,
 * }} ToolDeps
 * @typedef {{ deny: string, result?: undefined } | { result: string, deny?: undefined }} ToolAnswer
 */

/**
 * A plugin tool's result must be text (or content blocks): the hub's answer goes back as JSON text.
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
  return JSON.stringify(value ?? {}, null, 2)
}

/**
 * @param {string} name tool name without the mcp prefix
 * @param {Record<string, unknown>} input
 * @param {ToolDeps} deps
 * @returns {Promise<ToolAnswer>}
 */
export async function runLinkTool(name, input, deps) {
  if (name === 'link_build_stage') {
    if (!deps.build) return { deny: 'link_build_stage no está disponible en esta sesión.' }
    return runBuildTool(input, deps.build)
  }
  if (!['link_send', 'link_reply', 'link_peers'].includes(name)) return { deny: `herramienta desconocida: ${name}` }
  if (!deps.client) return { deny: 'sielay-link no está emparejado en esta máquina: corre /link pair <slot> (el slot lo crea un admin).' }
  try {
    if (name === 'link_peers') {
      if (input.online_only !== undefined && typeof input.online_only !== 'boolean') return { deny: 'online_only debe ser true o false.' }
      const answer = await deps.client.peers({ onlineOnly: input.online_only !== false })
      const peers = Array.isArray(answer?.peers) ? answer.peers : []
      const prefix = selfPrefixOf(answer)
      if (prefix) deps.notePrefix?.(prefix)
      const tu_direccion = await ownAddress({
        address: await deps.selfAddress(),
        addressPrefix: prefix,
        sessionName: async () => (await deps.sessionFrom()).name,
      })
      /** @param {Record<string, unknown>} p */
      const clean = p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'string' ? neutralizeBody(v).slice(0, 200) : v]))
      return { result: asText({ tu_direccion, peers: peers.map(clean) }) }
    }

    const textError = checkText(input.text)
    if (textError) return { deny: textError }
    /** @type {Record<string, unknown>} */
    const body = { from: await deps.sessionFrom() }

    if (name === 'link_send' && Array.isArray(input.to)) {
      if (input.conversation !== undefined) return { deny: 'Con varios destinatarios no va conversation: cada uno abre la suya.' }
      const to = [...new Set(input.to.map(toAddress))]
      if (to.length === 0 || to.length > MAX_RECIPIENTS) return { deny: `Pon entre 1 y ${MAX_RECIPIENTS} direcciones.` }
      const bad = to.find(a => !ADDRESS.test(a))
      if (bad !== undefined) return { deny: 'Cada dirección debe ser persona/máquina/sesión (mira link_peers).' }
      const sent = await deps.client.send({ ...body, to, client_msg_id: deps.newId(), body: input.text })
      const results = Array.isArray(sent?.results) ? sent.results : []
      for (const r of results) {
        if (r?.ok === true && typeof r.conversation_id === 'string' && typeof r.to === 'string') await deps.rememberConversation(r.conversation_id, r.to)
      }
      return { result: asText({ results: results.map(r => ({ ...r, nota: resultNote(r) })) }) }
    }

    if (name === 'link_send') {
      const to = toAddress(input.to)
      if (!ADDRESS.test(to)) return { deny: 'La dirección debe ser persona/máquina/sesión (mira link_peers).' }
      if (input.conversation !== undefined && !isConvId(input.conversation)) return { deny: 'conversation no es un id válido.' }
      body.to = to
      if (input.conversation !== undefined) body.conversation_id = input.conversation
    } else {
      if (!isConvId(input.conversation)) return { deny: 'conversation no es un id válido.' }
      const to = await deps.conversationPeer(input.conversation)
      if (!to) return { deny: 'No conozco esa conversación en esta sesión. Usa link_send con la dirección (to) y conversation.' }
      body.to = to
      body.conversation_id = input.conversation
    }
    body.client_msg_id = deps.newId()
    body.body = input.text
    if (name === 'link_reply' && input.end === true) body.end = true

    const sent = await deps.client.send(body)
    if (typeof sent?.conversation_id === 'string') await deps.rememberConversation(sent.conversation_id, String(body.to))
    return { result: asText({ ...sent, nota: noteFor(sent) }) }
  } catch (err) {
    const e = /** @type {{ code?: string, closedBy?: string, closedReason?: string }} */ (err ?? {})
    if (e.code === 'conversation_closed') return { result: closedConversationNote(e) }
    return { deny: describeHubError(err) }
  }
}

