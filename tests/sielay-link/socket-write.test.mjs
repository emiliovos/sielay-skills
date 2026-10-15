import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HELPER = fileURLToPath(new URL('../../plugins/sielay-link/bin/sielay-link-socket-write.mjs', import.meta.url))
const FAKE_TOKEN = 'socket-token-for-tests'

function runHelper(stdin, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [HELPER], { env: { PATH: process.env.PATH, ...env } })
    let stdout = ''
    child.stdout.on('data', d => (stdout += d))
    child.on('close', code => resolve({ code, stdout, report: JSON.parse(stdout.trim() || '{}'), argv: child.spawnargs }))
    child.stdin.end(stdin)
  })
}

async function withSocket(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'slk-sock-'))
  const path = join(dir, 's.sock')
  const received = []
  const server = net.createServer(c => {
    let buf = ''
    c.on('data', d => (buf += d))
    c.on('end', () => received.push(buf))
  })
  await new Promise(r => server.listen(path, r))
  try {
    return await fn(path, received)
  } finally {
    await new Promise(r => server.close(r))
    rmSync(dir, { recursive: true, force: true })
  }
}

test('writes exactly two lines, auth first, token from the environment', async () => {
  await withSocket(async (path, received) => {
    const r = await runHelper(`${JSON.stringify({ content: 'hola' })}\n`, {
      CLAUDE_CODE_MESSAGING_SOCKET: path,
      CLAUDE_CODE_MESSAGING_TOKEN: FAKE_TOKEN,
    })
    assert.equal(r.code, 0)
    assert.deepEqual(r.report, { ok: true })
    await new Promise(res => setTimeout(res, 20))
    const lines = received.join('').split('\n').filter(Boolean)
    assert.equal(lines.length, 2)
    assert.deepEqual(JSON.parse(lines[0]), { type: 'auth', token: FAKE_TOKEN })
    assert.deepEqual(JSON.parse(lines[1]), { type: 'user', message: { role: 'user', content: 'hola' } })
    assert.ok(!r.argv.some(a => a.includes(FAKE_TOKEN)), 'token never in argv')
    assert.ok(!r.stdout.includes(FAKE_TOKEN), 'token never printed')
  })
})

test('a socket or token on stdin is ignored: only the environment counts', async () => {
  await withSocket(async (path, received) => {
    const r = await runHelper(JSON.stringify({ content: 'x', socket: path, token: FAKE_TOKEN }), {})
    assert.equal(r.code, 2)
    assert.equal(r.report.code, 'no_socket')
    await new Promise(res => setTimeout(res, 20))
    assert.equal(received.length, 0, 'nothing was written to the socket named on stdin')
  })
})

test('no socket, no token and bad input exit with their own codes', async () => {
  assert.equal((await runHelper('{"content":"x"}', {})).report.code, 'no_socket')
  assert.equal((await runHelper('{"content":"x"}', { CLAUDE_CODE_MESSAGING_SOCKET: '/nonexistent' })).code, 3)
  assert.equal((await runHelper('not json', {})).code, 4)
  assert.equal((await runHelper('{"content":""}', {})).code, 4)
})

test('a socket that does not exist is a connect failure, not a hang', async () => {
  const r = await runHelper('{"content":"x"}', {
    CLAUDE_CODE_MESSAGING_SOCKET: join(tmpdir(), 'slk-missing.sock'),
    CLAUDE_CODE_MESSAGING_TOKEN: FAKE_TOKEN,
  })
  assert.equal(r.code, 1)
  assert.equal(r.report.code, 'connect_failed')
  assert.ok(!r.stdout.includes(FAKE_TOKEN))
})
