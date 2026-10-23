// Wires the pure parts to `$` for one loaded copy of the mod: hub client,
// delivery adapter, inbound handler, poll loop and pairing flow.

import { createHubClient, normalizeHubUrl } from './link-hub-client.js'
import { createDeliveryAdapter } from './link-delivery-adapter.js'
import { recordLaunchMode } from './link-launch-mode.js'
import { createInboundHandler } from './link-inbound-handler.js'
import { createPollLoop } from './link-poll-loop.js'
import { createPairingFlow } from './link-pairing.js'
import { buildSessionPayload, readMode } from './link-session-payload.js'
import { PANE_ID } from './link-state-refs.js'
import { afterPoll } from './link-build-hooks.js'

// $.state references: literal plugin/key, declared in each file that uses them.
const STRIP = /** @type {const} */ ({ plugin: 'sielay-link', key: 'strip' })
const OFF = /** @type {const} */ ({ plugin: 'sielay-link', key: 'off' })
const STATUS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'status' })
const PAIRING = /** @type {const} */ ({ plugin: 'sielay-link', key: 'pairing' })
const CONVERSATIONS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'conversations' })
const NOTICE = /** @type {const} */ ({ plugin: 'sielay-link', key: 'notice' })

export const CLIENT_VERSION = '1.4.0'

/** @typedef {import('claude-code').EngineInterface} Engine */
/** @typedef {import('../types/index.js').LinkStatus} LinkStatus */

/**
 * @param {Record<string, unknown>} options the userConfig values
 */
export function createRuntime(options) {
  return {
    options,
    hubUrl: /** @type {string|null} */ (null),
    hubError: /** @type {string|null} */ (null),
    token: '',
    /** @type {LinkStatus['tokenSource']} */
    tokenSource: 'none',
    client: /** @type {import('./link-hub-client.js').HubClient|null} */ (null),
    adapter: /** @type {import('./link-delivery-adapter.js').DeliveryAdapter|null} */ (null),
    handler: /** @type {import('./link-inbound-handler.js').InboundHandler|null} */ (null),
    loop: /** @type {ReturnType<typeof createPollLoop>|null} */ (null),
    pairing: /** @type {ReturnType<typeof createPairingFlow>|null} */ (null),
    tmux: /** @type {{ name?: string, at: number }} */ ({ at: -Infinity }),
    /** The session name, fixed at the first poll (link-session-payload.js); `/link name` clears it. */
    namePin: /** @type {import('./link-session-payload.js').NamePin|null} */ (null),
    /** The poll loop's last code (link_build_stage's `reason`); null until the first poll. Memory only. */
    loopCode: /** @type {import('./link-poll-loop.js').LoopCode|null} */ (null),
    /** The build held across a /clear (link-build-hooks.js). */
    buildCarry: /** @type {import('../types/index.js').LinkBuildState|null} */ (null),
    /** The last invalid build field logged, so it is logged once. */
    buildError: /** @type {string|null} */ (null),
    /** The discovery line went into this conversation (link-discovery-context.js); memory only, reset on session.end. */
    discoveryAnnounced: false,
    /** `self.address_prefix` from the last peers answer that carried it; memory only. */
    addressPrefix: /** @type {string|null} */ (null),
  }
}

/** @typedef {ReturnType<typeof createRuntime>} Runtime */

/** @param {Engine} $ @param {Partial<LinkStatus>} patch */
export async function patchStatus($, patch) {
  const { value } = await $.state.get(STATUS)
  await $.state.set(STATUS, { loop: 'starting', ...value, ...patch })
}

/** @param {Engine} $ */
export async function tokenFilePath($) {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  return home ? `${home.replace(/[\\/]+$/, '')}/.claude/sielay-link/token` : ''
}

/** @param {Engine} $ */
export async function isOff($) {
  if ((await $.env.get('SIELAY_LINK_OFF')) === '1') return true
  const { value = false } = await $.state.get(OFF)
  return value
}

/** @param {Engine} $ @param {Runtime} rt */
export async function sessionPayload($, rt) {
  return (await buildSessionPayload($, rt)).session
}

/**
 * The token in force: a non-empty `userConfig.link_token` wins, else the file.
 * @param {Engine} $ @param {Runtime} rt
 */
async function loadToken($, rt) {
  const fromConfig = typeof rt.options.link_token === 'string' ? rt.options.link_token.trim() : ''
  if (fromConfig) return { token: fromConfig, source: /** @type {const} */ ('config') }
  const path = await tokenFilePath($)
  try {
    if (path && (await $.fs.exists(path))) {
      const text = String(await $.fs.read(path)).trim()
      if (text) return { token: text, source: /** @type {const} */ ('file') }
    }
  } catch {
    // unreadable file: treated as not paired
  }
  return { token: '', source: /** @type {const} */ ('none') }
}

/**
 * Puts a token in force and (re)starts the loop.
 * @param {Engine} $ @param {Runtime} rt @param {string} token @param {LinkStatus['tokenSource']} source
 */
export async function activateToken($, rt, token, source) {
  if (!rt.hubUrl) return
  if (rt.tokenSource === 'config' && source === 'pairing') {
    await $.state.set(NOTICE, 'Hay un link_token en /plugin y ese gana: bórralo ahí para usar el token nuevo.')
    return
  }
  rt.token = token
  rt.tokenSource = source
  rt.client = token ? createHubClient($, { hubUrl: rt.hubUrl, token }) : null
  await patchStatus($, { tokenSource: source })
  rt.loopCode = null
  rt.loop?.start()
}

/**
 * After a 401: a token file that changed since this session read it (/up ran in another
 * terminal) is put in force, so an open session follows without /reload-plugins.
 * A `userConfig.link_token` still wins, as in loadToken.
 * @param {Engine} $ @param {Runtime} rt @returns {Promise<boolean>} whether a newer token was activated
 */
async function adoptNewerToken($, rt) {
  if (rt.tokenSource === 'config') return false
  const { token, source } = await loadToken($, rt)
  if (source !== 'file' || !token || token === rt.token) return false
  await activateToken($, rt, token, 'file')
  return true
}

/**
 * Called once per loaded copy from `session.start`.
 * @param {Engine} $ @param {Runtime} rt
 */
export async function startLink($, rt) {
  rt.loopCode = null
  try {
    rt.hubUrl = normalizeHubUrl(rt.options.hub_url)
  } catch (err) {
    rt.hubError = err instanceof Error ? err.message : String(err)
    await patchStatus($, { loop: 'error', detail: `hub_url rechazado: ${rt.hubError}` })
    return
  }
  const adapter = createDeliveryAdapter($, { helperPath: `${$.plugin.root}/bin/sielay-link-socket-write.mjs` })
  rt.adapter = adapter
  const mode = await adapter.detect()
  await recordLaunchMode($, adapter) // before the first poll, so the hub sees the mode at once
  if (mode === 'prompt') $.ui.toast('sielay-link: sin Node en el PATH, los mensajes llegan como prompt (modo respaldo).')

  rt.handler = createInboundHandler({
    store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) },
    adapter,
    readMode: () => readMode($),
    onStrip: async items => void (await $.state.set(STRIP, items)),
    onConversation: async d => {
      const address = d.from?.address
      if (!address) return
      const { value = {} } = await $.state.get(CONVERSATIONS)
      if (value[d.conversation_id] !== address) await $.state.set(CONVERSATIONS, { ...value, [d.conversation_id]: address })
    },
    log: msg => $.ui.log(`sielay-link: ${msg}`),
  })
  rt.loop = createPollLoop({
    schedule: (ms, fn) => void $.clock.after(ms, fn),
    getClient: () => rt.client,
    buildSession: async () => {
      const built = await buildSessionPayload($, rt, { withBuild: true })
      await patchStatus($, { name: built.session.name, nameSource: built.nameSource })
      return built.session
    },
    onPolled: session => afterPoll($, rt, session),
    handler: rt.handler,
    isOff: () => isOff($),
    onUnauthorized: () => adoptNewerToken($, rt),
    onStatus: (loop, detail, code) => {
      rt.loopCode = code
      return patchStatus($, { loop, detail })
    },
    onSession: s => patchStatus($, { address: s.address, name: s.name_assigned }),
  })
  rt.pairing = createPairingFlow({
    makeClient: () => createHubClient($, { hubUrl: rt.hubUrl, token: '' }),
    schedule: (ms, fn) => void $.clock.after(ms, fn),
    now: () => $.clock.now(),
    setView: async view => {
      await $.state.set(PAIRING, view)
      await $.ui.open({ id: PANE_ID, title: 'sielay-link' })
    },
    writeTokenFile: async token => {
      const path = await tokenFilePath($)
      if (!path) throw new Error('no HOME')
      await adapter.writeTokenFile(path, token)
    },
    onToken: token => activateToken($, rt, token, 'pairing'),
    hostname: () => adapter.hostname(),
    clientVersion: CLIENT_VERSION,
    tokenPath: '~/.claude/sielay-link/token',
  })

  const { token, source } = await loadToken($, rt)
  await patchStatus($, { hub: rt.hubUrl, adapter: mode, tokenSource: source, loop: token ? 'starting' : 'unpaired' })
  await activateToken($, rt, token, source)
}

/**
 * The context a strip decision needs (session payload re-read at press time).
 * @param {Engine} $ @param {Runtime} rt @param {string} id
 */
export async function decisionContext($, rt, id) {
  const client = rt.client
  if (!client) throw new Error('sin token: corre /link pair <slot>')
  const session = await sessionPayload($, rt)
  return {
    instanceId: session.instance_id,
    /** @param {'accepted'|'rejected'} decision */
    decide: (decision) => client.decide({ session, id, decision }),
    /** @param {{ id: string, outcome: 'injected'|'shown' }} a */
    ack: (a) => client.ack({ session, ack: [a] }),
  }
}
