// sielay-link: lets paired Claude Code sessions message each other through a
// sielay hub. Entry module (hooks/hooks.json). Every hook is registered here;
// the work lives in the modules it imports, most of them pure.

import { createRuntime, startLink, sessionPayload, isOff } from './link-runtime.js'
import { recordModeSample, recordSessionTitle, recordTurnEnd } from './link-session-payload.js'
import { LINK_TOOL_SPECS, runLinkTool } from './link-tools.js'
import { reportState } from './link-build-tool.js'
import { runLinkCommand } from './link-commands.js'
import { PROMPT_FALLBACK_CONTEXT } from './link-inbound-framing.js'
import { discoveryFor } from './link-discovery-context.js'
import { endOnClose } from './link-session-end.js'
import { renderBand } from './link-band.jsx'
import { renderPane } from './link-pane.jsx'
import {
  declareFromTool, noteSubagentStart, noteSubagentSpawn, noteSubagentStop, noteToolUse, noteTurnComplete, carryOnClear,
} from './link-build-hooks.js'

// $.state reference: literal plugin/key, declared in each file that uses it.
const CONVERSATIONS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'conversations' })
const STATUS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'status' })

/** @typedef {import('claude-code').EngineInterface} Engine */
/** @typedef {import('./link-runtime.js').Runtime} Runtime */

/**
 * Registers the tools and the command. Tools are left out entirely while
 * SIELAY_LINK_OFF=1, so the model never sees them.
 * @param {Engine} $ @param {Runtime} rt
 */
async function setUp($, rt) {
  await $.command.register({
    name: 'link',
    description: 'sielay-link: estado, nombre, pares y emparejamiento de esta sesión',
    argumentHint: '[name <x> | off | on | peers | pair <slot>]',
  })
  if ((await $.env.get('SIELAY_LINK_OFF')) === '1') return
  for (const spec of LINK_TOOL_SPECS) await $.tool.register(spec)
  await startLink($, rt)
}

/**
 * @param {Engine} $ @param {Runtime} rt @param {string} name @param {Record<string, unknown>} input
 */
async function callTool($, rt, name, input) {
  // link_build_stage never refuses for being off or unpaired: it stores and answers reported:false.
  if (name !== 'link_build_stage' && (await $.env.get('SIELAY_LINK_OFF')) === '1') return { deny: 'sielay-link está apagado (SIELAY_LINK_OFF=1).' }
  const answer = await runLinkTool(name, input, {
    client: rt.client,
    sessionFrom: async () => {
      const s = await sessionPayload($, rt)
      return { name: s.name, instance_id: s.instance_id, cwd_hash: s.cwd_hash, mode: s.mode, mode_fresh: s.mode_fresh, mode_age_s: s.mode_age_s }
    },
    sessionRepo: async () => (await sessionPayload($, rt)).repo,
    conversationPeer: async id => (await $.state.get(CONVERSATIONS)).value?.[id],
    rememberConversation: async (id, address) => {
      const { value = {} } = await $.state.get(CONVERSATIONS)
      await $.state.set(CONVERSATIONS, { ...value, [id]: address })
    },
    newId: () => crypto.randomUUID(),
    selfAddress: async () => (await $.state.get(STATUS)).value?.address,
    notePrefix: prefix => void (rt.addressPrefix = prefix),
    build: {
      declare: fields => declareFromTool($, rt, fields),
      canReport: async () => reportState({ paired: rt.client !== null, off: await isOff($), code: rt.loopCode }),
    },
  })
  return answer.deny !== undefined ? { deny: answer.deny } : { result: answer.result }
}

/**
 * `.catch` for hooks that only observe: whatever failed, the event goes on as it came.
 * @param {unknown} _$ @param {any} e @param {any} next
 */
function passThrough(_$, e, next) {
  return next(e)
}

/**
 * `.catch` for the tools: a failure is a refusal the model can read, never a hang.
 * @param {unknown} _$ @param {unknown} _e @param {any} next
 */
function toolFailed(_$, _e, next) {
  return next.called ? next(_e) : { deny: 'sielay-link falló al atender la herramienta; revisa /link.' }
}

/**
 * @param {import('claude-code').On} on
 * @param {import('claude-code').PluginOptions} options
 */
export function register(on, options) {
  const rt = createRuntime(/** @type {Record<string, unknown>} */ (options ?? {}))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      await setUp($, rt)
    } catch (err) {
      $.ui.log(`sielay-link no arrancó: ${err instanceof Error ? err.message : String(err)}`)
    }
    return started
  })

  // Mode samples (R5): only these classic events carry permission_mode.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await recordModeSample($, e, 'UserPromptSubmit')
    await recordSessionTitle($, e.session_title)
    return next(e)
  }).catch(passThrough)
  on('classic.PostToolUse', async ($, e, next) => {
    await recordModeSample($, e, 'PostToolUse')
    await noteToolUse($, rt, e)
    return next(e)
  }).catch(passThrough)
  on('classic.PostToolBatch', async ($, e, next) => {
    await recordModeSample($, e, 'PostToolBatch')
    return next(e)
  }).catch(passThrough)
  on('classic.Stop', async ($, e, next) => {
    await recordModeSample($, e, 'Stop')
    return next(e)
  }).catch(passThrough)
  // Every turn end, including Esc and API errors (which raise no classic Stop):
  // without it an interrupted turn would look like it is still running. It
  // also feeds the build: the turn's usage, and a subagent's run ending.
  on('turn.complete', async ($, e, next) => {
    await recordTurnEnd($, e)
    await noteTurnComplete($, rt, e)
    return next(e)
  }).catch(passThrough)

  // The build's live subagents (link-build-hooks.js). agent.spawn observes
  // only: the description from its input, the agentId from what next resolved.
  on('classic.SubagentStart', async ($, e, next) => {
    await noteSubagentStart($, rt, e)
    return next(e)
  }).catch(passThrough)
  on('classic.SubagentStop', async ($, e, next) => {
    await noteSubagentStop($, rt, e)
    return next(e)
  }).catch(passThrough)
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await noteSubagentSpawn($, rt, e, spawned)
    return spawned
  }).catch(passThrough)
  // /clear keeps the build (the rest of the session state is the host's).
  on('session.end', async ($, e, next) => {
    rt.discoveryAnnounced = false
    await carryOnClear($, rt, e)
    await endOnClose($, rt, e, () => isOff($))
    return next(e)
  }).catch(passThrough)
  on('classic.SessionStart', async ($, e, next) => {
    await recordSessionTitle($, e.session_title)
    return next(e)
  }).catch(passThrough)

  // The fallback adapter's own prompts carry a fixed context naming who sent
  // them; any other prompt may carry the once-per-conversation discovery line.
  // One hook: the engine refuses a second prompt.submit without a matcher.
  // The conversation is marked only once the prompt entered with the line: a
  // prompt another hook drops (or that fails) leaves it for the next one.
  on('prompt.submit', async ($, e, next) => {
    const ownPrompt = e.origin?.kind === 'plugin' && e.origin.name === $.plugin.name
    if (ownPrompt) return next({ ...e, context: [...(e.context ?? []), PROMPT_FALLBACK_CONTEXT] })
    if (rt.discoveryAnnounced) return next(e)
    const text = discoveryFor({
      announced: rt.discoveryAnnounced,
      connected: rt.client !== null,
      off: await isOff($),
      ownPrompt,
      command: e.command !== undefined,
      address: (await $.state.get(STATUS)).value?.address,
      addressPrefix: rt.addressPrefix,
    })
    if (text === null) return next(e)
    const entered = await next({ ...e, context: [...(e.context ?? []), text] })
    if (entered.drop === undefined) rt.discoveryAnnounced = true
    return entered
  }).catch(passThrough)

  // One answer per registered tool, so a tool can never be listed without a hook behind it.
  for (const { name } of LINK_TOOL_SPECS) {
    on('tool.call', { tool: `mcp__sielay-link__${name}` }, ($, e) => callTool($, rt, name, e)).catch(toolFailed)
  }

  on('command.run', { command: 'link' }, async ($, e) => runLinkCommand($, rt, e.args, e.origin))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => (await renderBand($, e, rt)) ?? next(e))
  on('ui.render', { component: 'Pane', requestId: 'sielay-link' }, async ($, e) => renderPane($, e, rt))
}
