// The tools the model gets: link_send, link_reply, link_peers, and
// link_build_stage, which only reports a build's progress (link-build-tool.js).
// There is deliberately no tool to decide, accept or release a message: only a
// person at the terminal (strip) or an admin with 2FA (dashboard) can.
// Pure (no `$`): the mod passes the hub client and session readers in.

import { normalizeName } from './link-session-name-resolution.js'
import { neutralizeBody } from './link-inbound-framing.js'
import { runBuildTool } from './link-build-tool.js'
import { watchBody } from './link-watch-tool.js'
import { LINK_TOOL_SPECS, MAX_RECIPIENTS } from './link-tool-specs.js'
import { ownAddress, selfPrefixOf } from './link-discovery-context.js'
import { ADDRESS } from './link-tool-address.js'
import { CODE_MESSAGES, describeHubError, closedConversationNote, sendAnswer, resultLine } from './link-tool-messages.js'

export { describeHubError, closedConversationNote, LINK_TOOL_SPECS }

const MAX_BODY_BYTES = 16 * 1024


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

const ATTACHMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

/**
 * @param {unknown} a
 * @returns {{ name: string, text: string } | null | string} the attachment, null when absent, or an error
 */
function checkAttachment(a) {
  if (a === undefined) return null
  const o = /** @type {{ name?: unknown, text?: unknown }} */ (a ?? {})
  if (typeof o.name !== 'string' || !ATTACHMENT_NAME.test(o.name)) return 'El adjunto necesita un nombre simple (letras, números, punto, guion).'
  if (typeof o.text !== 'string' || o.text === '') return 'El adjunto va vacío.'
  if (new TextEncoder().encode(o.text).length > 64 * 1024) return 'El adjunto pasa de 64 KB.'
  return { name: o.name, text: o.text }
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
 *   client: { send: (b: object) => Promise<any>, peers: (o?: { onlineOnly?: boolean }) => Promise<any>, watch?: (b: object) => Promise<any> } | null,
 *   sessionRepo?: () => Promise<string|null|undefined>,
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
 * A plugin tool's result must be text (or content blocks): the hub's answer goes back as JSON text
 * (link_peers, link_watch); link_send and link_reply answer in short lines instead.
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
  if (!['link_send', 'link_reply', 'link_peers', 'link_watch'].includes(name)) return { deny: `herramienta desconocida: ${name}` }
  if (!deps.client) return { deny: 'sielay-link no está emparejado en esta máquina: corre /link pair <slot> (el slot lo crea un admin).' }
  try {
    if (name === 'link_watch') {
      const client = deps.client
      if (!client.watch) return { deny: 'Este cliente no sabe vigilar ramas.' }
      const w = await watchBody(input, { watch: client.watch, session: deps.sessionFrom, sessionRepo: deps.sessionRepo ?? (async () => null) })
      if (w.error !== undefined) return { deny: w.error }
      return { result: asText(await client.watch(w.body)) }
    }
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
    const attachment = checkAttachment(input.attachment)
    if (typeof attachment === 'string') return { deny: attachment }
    /** @type {Record<string, unknown>} */
    const body = { from: await deps.sessionFrom() }

    if (name === 'link_send' && Array.isArray(input.to)) {
      if (input.conversation !== undefined) return { deny: 'Con varios destinatarios no va conversation: cada uno abre la suya.' }
      const to = [...new Set(input.to.map(toAddress))]
      if (to.length === 0 || to.length > MAX_RECIPIENTS) return { deny: `Pon entre 1 y ${MAX_RECIPIENTS} direcciones.` }
      const bad = to.find(a => !ADDRESS.test(a))
      if (bad !== undefined) return { deny: 'Cada dirección debe ser persona/máquina/sesión (mira link_peers).' }
      const sent = await deps.client.send({ ...body, to, client_msg_id: deps.newId(), body: input.text, ...(attachment ? { attachment } : {}) })
      const results = Array.isArray(sent?.results) ? sent.results : []
      for (const r of results) {
        if (r?.ok === true && typeof r.conversation_id === 'string' && typeof r.to === 'string') await deps.rememberConversation(r.conversation_id, r.to)
      }
      return { result: results.length > 0 ? results.map(resultLine).join('\n') : 'El hub no devolvió resultados.' }
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
    if (attachment) body.attachment = attachment
    if (name === 'link_reply' && input.end === true) body.end = true

    const sent = await deps.client.send(body)
    if (typeof sent?.conversation_id === 'string') await deps.rememberConversation(sent.conversation_id, String(body.to))
    return { result: sendAnswer(sent, String(body.to)) }
  } catch (err) {
    const e = /** @type {{ code?: string, closedBy?: string, closedReason?: string }} */ (err ?? {})
    if (e.code === 'conversation_closed') return { result: closedConversationNote(e) }
    return { deny: describeHubError(err) }
  }
}

