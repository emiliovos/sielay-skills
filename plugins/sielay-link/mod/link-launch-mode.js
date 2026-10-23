// The permission mode a session was launched in, recorded once at start.
//
// Claude Code carries `permission_mode` only on classic UserPromptSubmit,
// PostToolUse, PostToolBatch and Stop (2.1.309: never on SessionStart, and `$`
// has no reader for it), so a fresh or resumed session reported `unknown` until
// its first prompt and nothing could auto-run in it. At start the mode is the
// launch's: `--dangerously-skip-permissions` or `--permission-mode <m>` on the
// command line (read from this Claude Code process, whose PID names its
// messaging socket), else `permissions.defaultMode` from the merged settings.
//
// Recorded only when the session has no mode sample yet: a reload keeps
// `$.state`, so it never overwrites a mode seen after the launch (a shift+tab).
// The sample stands for an idle session (lastStopAt = now): nothing is running.

const MODE_SAMPLES = /** @type {const} */ ({ plugin: 'sielay-link', key: 'modeSamples' })
const LAST_STOP_AT = /** @type {const} */ ({ plugin: 'sielay-link', key: 'lastStopAt' })

export const LAUNCH_EVENT = 'SessionStart'
const MODES = new Set(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'])

/**
 * The PID in the messaging socket's name (`…/cc-socks/<pid>.sock`).
 * @param {string|undefined} socket
 * @returns {string|undefined}
 */
export function pidFromSocket(socket) {
  const m = /[\\/](\d{1,10})\.sock$/.exec(String(socket ?? ''))
  return m ? m[1] : undefined
}

/**
 * The mode the command line sets, or undefined when it sets none.
 * @param {string|undefined} args the process's command line, space-separated
 * @returns {string|undefined}
 */
export function modeFromArgs(args) {
  const words = String(args ?? '').split(/\s+/)
  let mode
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w === '--dangerously-skip-permissions') mode = 'bypassPermissions'
    else if (w === '--permission-mode' && MODES.has(words[i + 1])) mode = words[i + 1]
    else if (w.startsWith('--permission-mode=') && MODES.has(w.slice('--permission-mode='.length))) mode = w.slice('--permission-mode='.length)
  }
  return mode
}

/**
 * The launch mode: the command line's, else the settings' defaultMode, else
 * `default` when the command line was read; undefined when nothing is known.
 * @param {{ args: string|undefined, defaultMode: unknown }} input
 * @returns {string|undefined}
 */
export function launchMode({ args, defaultMode }) {
  const fromArgs = modeFromArgs(args)
  if (fromArgs) return fromArgs
  if (typeof defaultMode === 'string' && MODES.has(defaultMode)) return defaultMode
  return args === undefined ? undefined : 'default'
}

/**
 * Records the launch mode when the session has no mode sample. Never throws:
 * a failed reading leaves the session as before (`unknown` until its first event).
 * @param {import('claude-code').EngineInterface} $
 * @param {{ processArgs: (pid: string) => Promise<string|undefined> }} adapter
 */
export async function recordLaunchMode($, adapter) {
  try {
    const { value: samples = [] } = await $.state.get(MODE_SAMPLES)
    if (samples.length > 0) return
    const pid = pidFromSocket(await $.env.get('CLAUDE_CODE_MESSAGING_SOCKET'))
    const [args, permissions] = await Promise.all([
      pid ? adapter.processArgs(pid) : Promise.resolve(undefined),
      $.settings.read({ key: 'permissions' }).catch(() => undefined),
    ])
    const mode = launchMode({ args, defaultMode: /** @type {{ defaultMode?: unknown }|undefined} */ (permissions)?.defaultMode })
    if (!mode) return
    const now = await $.clock.now()
    await $.state.set(MODE_SAMPLES, [{ mode, at: now, event: LAUNCH_EVENT }])
    await $.state.set(LAST_STOP_AT, now)
  } catch (err) {
    $.ui.log(`sielay-link: no se leyó el modo de arranque (${err instanceof Error ? err.name : typeof err})`)
  }
}
