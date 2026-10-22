// Builds what the hub sees of this session on every poll and send: name,
// instance_id, cwd_hash (of the project root, see sessionDir), mode
// (+ freshness and age) and state, plus, on a poll
// with a build declared and valid, `build` (link-build-hooks.js). Reads `$`.

import { modeState } from './link-mode-freshness.js'
import { resolveSessionName, cwdHash } from './link-session-name-resolution.js'
import { claimInstanceId, instanceKey } from './link-instance-identity.js'
import { pollBuild } from './link-build-hooks.js'

// $.state references: literal plugin/key, declared in each file that uses them.
const MODE_SAMPLES = /** @type {const} */ ({ plugin: 'sielay-link', key: 'modeSamples' })
const LAST_STOP_AT = /** @type {const} */ ({ plugin: 'sielay-link', key: 'lastStopAt' })
const SESSION_TITLE = /** @type {const} */ ({ plugin: 'sielay-link', key: 'sessionTitle' })

const MAX_SAMPLES = 8
const TMUX_TTL_MS = 5 * 60_000
/** Classic events that carry `permission_mode` (Claude Code 2.1.300). */
export const MODE_EVENTS = Object.freeze(['UserPromptSubmit', 'PostToolUse', 'PostToolBatch', 'Stop'])

/** @typedef {import('claude-code').EngineInterface} Engine */

/**
 * Records the mode a classic hook carried. Subagent events are skipped: the
 * main session's mode is the one that gates delivery.
 *
 * @param {Engine} $
 * @param {{ permission_mode?: string, agent_id?: string }} e
 * @param {string} event
 */
export async function recordModeSample($, e, event) {
  const now = await $.clock.now()
  if (event === 'Stop' && !e.agent_id) await $.state.set(LAST_STOP_AT, now)
  if (typeof e.permission_mode !== 'string' || e.permission_mode === '' || e.agent_id) return
  const { value = [] } = await $.state.get(MODE_SAMPLES)
  await $.state.set(MODE_SAMPLES, [...value, { mode: e.permission_mode, at: now, event }].slice(-MAX_SAMPLES))
}

/**
 * Stamps the end of a main-loop turn however it ended (answer, Esc, error).
 * @param {Engine} $
 * @param {{ agentId?: string }} e the `turn.complete` input
 */
export async function recordTurnEnd($, e) {
  if (e.agentId) return
  await $.state.set(LAST_STOP_AT, await $.clock.now())
}

/**
 * @param {Engine} $
 * @param {unknown} title the classic `session_title`
 */
export async function recordSessionTitle($, title) {
  if (typeof title === 'string' && title.trim() !== '') await $.state.set(SESSION_TITLE, title.trim())
}

/**
 * The mode as of now (see link-mode-freshness.js for the policy).
 * @param {Engine} $
 */
export async function readMode($) {
  const [{ value: samples = [] }, { value: lastStopAt = null }, now] = await Promise.all([
    $.state.get(MODE_SAMPLES),
    $.state.get(LAST_STOP_AT),
    $.clock.now(),
  ])
  return modeState({ samples, lastStopAt, now })
}

/**
 * The folder this session's identity is computed from: its project root
 * (`$.session.root()`), where it started or where `/cd` or a worktree took it.
 * A shell `cd` does not move it, so a terminal that works inside another
 * project's folder never turns into that project's session (which took over
 * the other terminal's session and its strip). Falls back to the live cwd on
 * a Claude Code without `root()`.
 * @param {Engine} $
 * @returns {Promise<string>}
 */
export async function sessionDir($) {
  try {
    return await $.session.root()
  } catch {
    // an engine without root(), or one that does not answer it: the live cwd
    return $.session.cwd()
  }
}

/**
 * @param {Engine} $
 * @param {string} cwd
 * @returns {Promise<{ name?: string, project?: string }>}
 */
async function readProjectFile($, cwd) {
  const path = `${cwd.replace(/[\\/]+$/, '')}/.claude/sielay-link.json`
  try {
    if (!(await $.fs.exists(path))) return {}
    const raw = JSON.parse(String(await $.fs.read(path)))
    return {
      name: typeof raw?.name === 'string' ? raw.name : undefined,
      project: typeof raw?.project === 'string' ? raw.project.slice(0, 80) : undefined,
    }
  } catch {
    return {}
  }
}

/**
 * The instance_id for (cwd, name): reused across reloads, /clear, --resume and
 * restarts, distinct for a second terminal live in the same folder (see
 * link-instance-identity.js). The owner is this Claude Code process's
 * messaging socket, which exists only while the process lives.
 * @param {Engine} $ @param {string} hash @param {string} name @param {string} sessionId @param {number} now
 */
async function instanceIdFor($, hash, name, sessionId, now) {
  const socket = await $.env.get('CLAUDE_CODE_MESSAGING_SOCKET')
  return claimInstanceId({
    store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) },
    key: instanceKey(hash, name),
    me: socket ? `sock:${socket}` : `sess:${sessionId}`,
    now,
    ownerAlive: async owner => (owner.startsWith('sock:') ? $.fs.exists(owner.slice(5)) : true),
    newId: () => crypto.randomUUID(),
  })
}

/**
 * The poll's build; a failure while reading it never stops the poll: the poll
 * goes without `build` and the log names the error's kind, never its text.
 * @param {Engine} $ @param {import('./link-build-hooks.js').BuildRuntime} rt
 */
async function safePollBuild($, rt) {
  try {
    return await pollBuild($, rt)
  } catch (err) {
    $.ui.log(`sielay-link: build no enviado, falló al leerlo (${err instanceof Error ? err.name : typeof err})`)
    return undefined
  }
}

/**
 * @typedef {{ adapter: { tmuxSessionName: (env: string|undefined) => Promise<string|undefined> } | null, tmux: { name?: string, at: number } }
 *   & import('./link-build-hooks.js').BuildRuntime} PayloadRuntime
 */

/**
 * @param {Engine} $
 * @param {PayloadRuntime} rt
 * @param {{ withBuild?: boolean }} [options] withBuild: the poll's payload, which carries the build
 */
export async function buildSessionPayload($, rt, { withBuild = false } = {}) {
  const [sessionId, cwd, now] = await Promise.all([$.session.id(), sessionDir($), $.clock.now()])
  const hash = await cwdHash(cwd)
  if (rt.adapter && now - rt.tmux.at > TMUX_TTL_MS) {
    rt.tmux = { name: await rt.adapter.tmuxSessionName(await $.env.get('TMUX')), at: now }
  }
  const [project, saved, { value: title }, env, mode] = await Promise.all([
    readProjectFile($, cwd),
    $.store.get(`name.${hash}`),
    $.state.get(SESSION_TITLE),
    $.env.get('SIELAY_LINK_NAME'),
    readMode($),
  ])
  const resolved = resolveSessionName({
    env,
    saved: typeof saved === 'string' ? saved : undefined,
    projectFile: project.name,
    tmux: rt.tmux.name,
    nativeTitle: title ?? undefined,
    cwd,
  })
  const instanceId = await instanceIdFor($, hash, resolved.name, sessionId, now)
  const build = withBuild ? await safePollBuild($, rt) : undefined
  return {
    session: {
      name: resolved.name,
      instance_id: instanceId,
      cwd_hash: hash,
      mode: mode.mode,
      mode_fresh: mode.fresh ? 1 : 0,
      mode_age_s: mode.ageMs === null ? null : Math.floor(mode.ageMs / 1000),
      state: mode.state,
      ...(project.project ? { project: project.project } : {}),
      ...(build ? { build } : {}),
    },
    nameSource: resolved.source,
    mode,
  }
}
