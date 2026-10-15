#!/usr/bin/env node
// sielay-link socket writer. Run by the mod with `$.process.run`, never by hand.
//
// Reads ONE JSON line on stdin: {"content": "<framed text>"}. Writes exactly
// two NDJSON lines to this session's inbox socket, auth first:
//   {"type":"auth","token":<CLAUDE_CODE_MESSAGING_TOKEN>}
//   {"type":"user","message":{"role":"user","content":<content>}}
// The socket and its token come only from the environment the session hands
// its children (never from stdin or argv), and the token is never printed. Prints one
// JSON status line. Exit codes: 0 written, 1 socket error, 2 no socket,
// 3 no token, 4 bad input.
import net from 'node:net'

const MAX_INPUT = 256 * 1024
const TIMEOUT_MS = 10_000

/** @param {number} code @param {Record<string, unknown>} report */
function finish(code, report) {
  process.stdout.write(`${JSON.stringify(report)}\n`)
  process.exitCode = code
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  input += chunk
  if (input.length > MAX_INPUT) {
    finish(4, { ok: false, code: 'bad_input', err: 'input too large' })
    process.exit()
  }
})
process.stdin.on('end', () => {
  /** @type {{ content?: unknown }} */
  let msg
  try {
    msg = JSON.parse(input.trim())
  } catch {
    return finish(4, { ok: false, code: 'bad_input', err: 'stdin is not JSON' })
  }
  if (typeof msg?.content !== 'string' || msg.content === '') {
    return finish(4, { ok: false, code: 'bad_input', err: 'content must be a non-empty string' })
  }
  const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET
  const token = process.env.CLAUDE_CODE_MESSAGING_TOKEN
  if (!socket) return finish(2, { ok: false, code: 'no_socket', err: 'CLAUDE_CODE_MESSAGING_SOCKET is not set' })
  if (!token) return finish(3, { ok: false, code: 'no_token', err: 'CLAUDE_CODE_MESSAGING_TOKEN is not set' })

  let done = false
  const conn = net.createConnection(socket, () => {
    conn.write(`${JSON.stringify({ type: 'auth', token })}\n`)
    conn.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content: msg.content } })}\n`)
  })
  conn.setTimeout(TIMEOUT_MS, () => conn.destroy(new Error('socket timeout')))
  conn.on('data', () => {}) // the socket sends no receipt; drain anything it might.
  conn.on('error', err => {
    if (done) return
    done = true
    const code = /** @type {NodeJS.ErrnoException} */ (err).code
    const preConnect = code === 'ENOENT' || code === 'ECONNREFUSED' || code === 'EACCES'
    finish(1, { ok: false, code: preConnect ? 'connect_failed' : 'write_failed', err: err.message })
  })
  conn.on('close', hadError => {
    if (done || hadError) return
    done = true
    finish(0, { ok: true })
  })
})
