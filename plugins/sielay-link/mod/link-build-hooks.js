// Wires the build state (link-build-state.js) to `$`: every hook that feeds it,
// the read the poll makes and the cleanup after a `done` went out. Writes go
// through `ifVersion`, so two hooks landing together never lose an update.
//
// /clear: `$.state` is the host's for the session, and a /clear goes on under a
// new session id with no session.start. The build is held in the runtime at
// `session.end` (reason `clear`) and put back on the next write if the state
// came back empty, so a /clear never drops the build.

import { declareBuild, subagentUp, subagentSeen, subagentDown, addUsage, addActiveTime, forgetIfDone, buildReport, pruneExpired } from './link-build-state.js'

// $.state reference: literal plugin/key, declared in each file that uses it.
const BUILD = /** @type {const} */ ({ plugin: 'sielay-link', key: 'build' })
const MAX_TRIES = 5

/** @typedef {import('claude-code').EngineInterface} Engine */
/** @typedef {import('../types/index.js').LinkBuildState} BuildState */
/** @typedef {{ buildCarry: BuildState|null, buildError: string|null }} BuildRuntime */

/**
 * Applies `fn` to the build and writes it when it changed. The one place that
 * touches `$` here (the engine's call list stays short enough to read whole).
 * @param {Engine} $ @param {BuildRuntime} rt
 * @param {(state: BuildState|null, now: number) => BuildState|null} fn
 * @returns {Promise<{ state: BuildState|null, now: number }>}
 */
async function update($, rt, fn) {
  const now = await $.clock.now()
  for (let i = 0; i < MAX_TRIES; i++) {
    const held = await $.state.get(BUILD)
    const restoring = (held.value ?? null) === null && rt.buildCarry !== null
    if (!restoring) rt.buildCarry = null
    const current = restoring ? rt.buildCarry : held.value ?? null
    const next = fn(current, now)
    if (next === current && !restoring) return { state: current, now }
    if ((await $.state.set(BUILD, next, { ifVersion: held.version })).isSet) {
      rt.buildCarry = null
      return { state: next, now }
    }
  }
  throw new Error('el estado del build cambió demasiadas veces seguidas')
}

/**
 * link_build_stage: merges and stores the call when the result is valid.
 * @param {Engine} $ @param {BuildRuntime} rt @param {Record<string, unknown>} input
 * @returns {Promise<{ error?: string }>}
 */
export async function declareFromTool($, rt, input) {
  /** @type {string|undefined} */
  let error
  await update($, rt, (state, now) => {
    const next = declareBuild(state, input, now)
    error = buildReport(next, now).error
    return error ? state : next
  })
  return error ? { error } : {}
}

/** @param {Engine} $ @param {BuildRuntime} rt @param {{ agent_id?: unknown, agent_type?: unknown }} e classic SubagentStart */
export async function noteSubagentStart($, rt, e) {
  await update($, rt, (s, now) => subagentUp(s, { id: e.agent_id, type: e.agent_type }, now))
}

/**
 * agent.spawn: its input has the description, its result the agentId.
 * @param {Engine} $ @param {BuildRuntime} rt
 * @param {{ description?: unknown, subagentType?: unknown }} input @param {unknown} result what next(e) resolved to
 */
export async function noteSubagentSpawn($, rt, input, result) {
  const id = result && typeof result === 'object' && 'agentId' in result ? result.agentId : undefined
  if (typeof id !== 'string') return
  await update($, rt, (s, now) => subagentUp(s, { id, type: input.subagentType, description: input.description }, now))
}

/** @param {Engine} $ @param {BuildRuntime} rt @param {{ agent_id?: unknown }} e classic SubagentStop */
export async function noteSubagentStop($, rt, e) {
  await update($, rt, s => subagentDown(s, e.agent_id))
}

/** @param {Engine} $ @param {BuildRuntime} rt @param {{ agent_id?: unknown }} e classic PostToolUse */
export async function noteToolUse($, rt, e) {
  if (typeof e.agent_id === 'string') await update($, rt, (s, now) => subagentSeen(s, e.agent_id, now))
}

/**
 * Every turn end: its usage and its duration count (main loop or subagent),
 * and a subagent's run ending is its stop when no SubagentStop came.
 * @param {Engine} $ @param {BuildRuntime} rt @param {{ agentId?: string, usage?: unknown, durationMs?: unknown }} e turn.complete
 */
export async function noteTurnComplete($, rt, e) {
  await update($, rt, s => {
    const counted = addActiveTime(addUsage(s, e.usage, !e.agentId), e.durationMs)
    return e.agentId ? subagentDown(counted, e.agentId) : counted
  })
}

/** @param {Engine} $ @param {BuildRuntime} rt @param {{ reason?: string }} e session.end */
export async function carryOnClear($, rt, e) {
  if (e.reason === 'clear') rt.buildCarry = (await update($, rt, s => s)).state
}

/**
 * The `session.build` for this poll, or undefined when there is no build or it
 * fails the hub's rules (then it is not sent, and the field is logged once).
 * @param {Engine} $ @param {BuildRuntime} rt
 * @returns {Promise<Record<string, unknown>|undefined>}
 */
export async function pollBuild($, rt) {
  const { state, now } = await update($, rt, (s, at) => pruneExpired(s, at))
  if (!state) return undefined
  const report = buildReport(state, now)
  if (report.error !== undefined) {
    if (rt.buildError !== report.error) $.ui.log(`sielay-link: build no enviado, campo inválido: ${report.error}`)
    rt.buildError = report.error
    return undefined
  }
  rt.buildError = null
  return report.build ?? undefined
}

/**
 * After a poll went through: a build it carried as `done` is forgotten.
 * @param {Engine} $ @param {BuildRuntime} rt @param {Record<string, unknown>} session the session the poll sent
 */
export async function afterPoll($, rt, session) {
  if (session.build !== undefined) await update($, rt, s => forgetIfDone(s, session.build))
}
