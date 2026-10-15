// Delivery adapter and the plugin's single host-process boundary: every
// `$.process.run` the plugin makes goes through this file (the check script
// forbids it anywhere else). It takes the engine `$` (only `$.process.run`
// and `$.prompt.submit` are used), so tests pass a fake `$`.
//
// Modes:
// - `socket` (default): runs bin/sielay-link-socket-write.mjs with Node; the
//   child inherits CLAUDE_CODE_MESSAGING_SOCKET/_TOKEN and writes auth + user
//   lines. The socket gives no receipt: success means "written".
// - `prompt` (no Node, or no socket in this session): `$.prompt.submit({text})`
//   without `asUser`; the mod's prompt.submit hook adds a fixed context.

/**
 * @typedef {{ exitCode: number, stdout: string, stderr: string }} RunResult
 * @typedef {{
 *   process: { run: (argv: readonly string[], init?: { stdin?: string, timeoutMs?: number, cwd?: string }) => Promise<RunResult> },
 *   prompt: { submit: (args: { text: string }) => Promise<unknown> },
 * }} ProcessEngine
 * @typedef {'socket'|'prompt'} AdapterMode
 */

/** Helper failures that prove nothing was written, so the prompt fallback cannot duplicate. */
const NOTHING_WRITTEN = new Set(['no_socket', 'no_token', 'connect_failed'])

/**
 * @param {string} stdout
 * @returns {{ ok?: boolean, code?: string, err?: string }}
 */
function lastJsonLine(stdout) {
  const line = String(stdout).trim().split('\n').pop() ?? ''
  try {
    return JSON.parse(line)
  } catch {
    return {}
  }
}

/**
 * @param {ProcessEngine} $ the engine (or a fake with `process.run` and `prompt.submit`)
 * @param {{ helperPath: string }} opts
 */
export function createDeliveryAdapter($, { helperPath }) {
  /** @type {AdapterMode} */
  let mode = 'socket'

  return {
    /** @returns {AdapterMode} */
    get mode() {
      return mode
    },

    /**
     * Picks `socket` when `node --version` runs, `prompt` otherwise.
     * @returns {Promise<AdapterMode>}
     */
    async detect() {
      try {
        const r = await $.process.run(['node', '--version'], { timeoutMs: 5_000 })
        mode = r.exitCode === 0 && /^v\d+/.test(r.stdout.trim()) ? 'socket' : 'prompt'
      } catch {
        mode = 'prompt'
      }
      return mode
    },

    /**
     * Delivers framed text into this session. Throws when it could not, so
     * the caller does not ack and the hub's lease redelivers.
     *
     * @param {string} text
     * @returns {Promise<{ via: AdapterMode }>}
     */
    async inject(text) {
      if (typeof text !== 'string' || text === '') throw new Error('nothing to inject')
      if (mode === 'socket') {
        const r = await $.process.run(['node', helperPath], {
          stdin: `${JSON.stringify({ content: text })}\n`,
          timeoutMs: 15_000,
        })
        const report = lastJsonLine(r.stdout)
        if (r.exitCode === 0 && report.ok === true) return { via: 'socket' }
        if (!NOTHING_WRITTEN.has(String(report.code))) {
          throw new Error(`socket write failed: ${report.code ?? `exit ${r.exitCode}`}`)
        }
      }
      await $.prompt.submit({ text })
      return { via: 'prompt' }
    },

    /**
     * Writes the link token to a 0600 file in a 0700 folder. The token travels
     * on stdin, never in argv; an older file is removed first, so the token is
     * never written into a file that already had wider permissions.
     *
     * @param {string} path absolute path
     * @param {string} token
     */
    async writeTokenFile(path, token) {
      if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) throw new Error('token path must be absolute')
      const r = await $.process.run(
        ['sh', '-c', 'umask 077; d="$(dirname "$1")"; mkdir -p "$d" && chmod 700 "$d" && rm -f "$1" && cat > "$1" && chmod 600 "$1"', '_', path],
        { stdin: token, timeoutMs: 10_000 },
      )
      if (r.exitCode !== 0) throw new Error(`could not write the token file (exit ${r.exitCode})`)
    },

    /**
     * The tmux session name, when this session runs inside tmux.
     * @param {string|undefined} tmuxEnv the TMUX variable
     * @returns {Promise<string|undefined>}
     */
    async tmuxSessionName(tmuxEnv) {
      if (!tmuxEnv) return undefined
      try {
        const r = await $.process.run(['tmux', 'display-message', '-p', '#S'], { timeoutMs: 3_000 })
        const name = r.stdout.trim()
        return r.exitCode === 0 && name ? name : undefined
      } catch {
        return undefined
      }
    },

    /** @returns {Promise<string|undefined>} the machine's hostname, shown to the approving admin */
    async hostname() {
      try {
        const r = await $.process.run(['hostname'], { timeoutMs: 3_000 })
        return r.exitCode === 0 ? r.stdout.trim().slice(0, 100) || undefined : undefined
      } catch {
        return undefined
      }
    },
  }
}

/** @typedef {ReturnType<typeof createDeliveryAdapter>} DeliveryAdapter */
