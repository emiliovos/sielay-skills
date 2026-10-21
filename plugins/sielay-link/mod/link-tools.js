// The tools the model gets: link_send, link_reply, link_peers, and
// link_build_stage, which only reports a build's progress (link-build-tool.js).
// There is deliberately no tool to decide, accept or release a message: only a
// person at the terminal (strip) or an admin with 2FA (dashboard) can.
// Pure (no `$`): the mod passes the hub client and session readers in.

import { normalizeName } from './link-session-name-resolution.js'
import { neutralizeBody } from './link-inbound-framing.js'
import { BUILD_TOOL_SPEC, runBuildTool } from './link-build-tool.js'
import { ownAddress, selfPrefixOf } from './link-discovery-context.js'

const MAX_BODY_BYTES = 16 * 1024

/** @type {ReadonlyArray<{ name: string, description: string, inputSchema: Record<string, unknown>, isDeferred: false }>} */
export const LINK_TOOL_SPECS = Object.freeze([
  {
    name: 'link_send',
    description:
      'Envía un mensaje a otra sesión de Claude Code emparejada por sielay-link (dirección persona/máquina/sesión; ' +
      'usa link_peers para verlas). Abre una conversación nueva salvo que pases `conversation`. ' +
      'El hub decide si el receptor lo ejecuta solo o lo deja en su franja para que una persona lo acepte.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['to', 'text'],
      properties: {
        to: { type: 'string', description: 'Dirección destino: persona/máquina/sesión' },
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
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    isDeferred: false,
  },
  BUILD_TOOL_SPEC,
])

/** @type {Record<string, string>} */
const CODE_MESSAGES = {
  turn_cap: 'La conversación llegó a su tope de turnos. Un admin puede extenderla desde el dashboard; si no, termina aquí.',
  pair_budget: 'Este par agotó su presupuesto de turnos (30 en 6 h). Espera o pide a un admin que lo revise.',
  pair_cooldown: 'Una conversación de este par llegó al tope hace poco: espera 30 min antes de abrir otra.',
  conversation_closed: 'Esa conversación está cerrada. Abre una nueva con link_send si hace falta.',
  not_paired: 'No estás emparejado con esa sesión. Un admin tiene que crear el par.',
  unknown_peer: 'No existe esa dirección. Revisa las disponibles con link_peers.',
  too_large: 'El mensaje pasa de 16 KB. Resúmelo o divídelo.',
  invalid: 'El hub rechazó el mensaje por formato inválido.',
  too_many_sessions: 'Esta máquina abrió más de 16 sesiones nuevas en 7 días. Reusa una sesión (mismo nombre y carpeta) o pide a un admin que revise.',
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function describeHubError(err) {
  const e = /** @type {{ kind?: string, code?: string, message?: string }} */ (err ?? {})
  const known = e.code ? CODE_MESSAGES[e.code] : undefined
  if (known) return known
  if (e.kind === 'paused') return 'sielay-link está apagado en el hub ahora mismo.'
  if (e.kind === 'unauthorized' || e.kind === 'no_token') return 'El token de sielay-link no sirve: vuelve a emparejar con /link pair <slot>.'
  if (e.kind === 'rate_limited') return 'El hub pide esperar (demasiadas peticiones). Intenta en un momento.'
  if (e.kind === 'network') return 'No se pudo contactar al hub de sielay-link.'
  return `sielay-link: ${e.message ?? String(err)}`
}

const ADDRESS = /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/

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
 * @param {{ gate?: string }} sent
 * @returns {string}
 */
function noteFor(sent) {
  if (sent.gate === 'held') return 'Mensaje retenido: espera que un admin lo libere a la franja del receptor.'
  return 'Enviado. Si el receptor está en bypass y el par tiene auto-ejecución, corre solo; si no, queda en su franja hasta que una persona lo acepte.'
}

/**
 * @typedef {{
 *   client: { send: (b: object) => Promise<any>, peers: () => Promise<any> } | null,
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
      const answer = await deps.client.peers()
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

    if (name === 'link_send') {
      const to = typeof input.to === 'string' ? input.to.split('/').map(normalizeName).join('/') : ''
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
    return { deny: describeHubError(err) }
  }
}
