// The `sielay` MCP headersHelper (bin/sielay-mcp-headers.sh → .mjs, or sh +
// curl without Node): reads ~/.claude/sielay-link/token, trades it for an MCP
// token at the hub and prints exactly {"Authorization":"Bearer <token>"}.
// It writes nothing, fails closed without the file or on any answer that is
// not a token, and never prints the credential nor passes it in argv.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFakeHub } from './fake-hub-server.mjs'

const SH = fileURLToPath(new URL('../../plugins/sielay-link/bin/sielay-mcp-headers.sh', import.meta.url))
const PRELOAD = fileURLToPath(new URL('./mcp-fetch-to-fake-hub.mjs', import.meta.url))
const SLK = 'slk_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0u1v'
const MCP = 'c0ffee'.repeat(10) + 'beef'

function home({ token = SLK } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'slk-mcp-'))
  const h = join(dir, 'home')
  mkdirSync(join(h, '.claude', 'sielay-link'), { recursive: true, mode: 0o700 })
  if (token !== null) writeFileSync(join(h, '.claude', 'sielay-link', 'token'), `${token}\n`, { mode: 0o600 })
  return { dir, h, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function run(env) {
  return new Promise(resolve => {
    const child = spawn('/bin/sh', [SH], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('close', code => resolve({ code, stdout, stderr, argv: child.spawnargs.join(' ') }))
  })
}

const listing = dir => execFileSync('find', [dir, '-mindepth', '1']).toString().split('\n').filter(Boolean).sort()

async function withHub(fn) {
  const hub = await startFakeHub({ token: SLK })
  try { return await fn(hub) } finally { await hub.close() }
}
const nodeEnv = (h, hub) => ({ PATH: process.env.PATH, HOME: h, FAKE_HUB_PORT: String(hub.port), NODE_OPTIONS: `--import=${PRELOAD}` })

test('with Node: exchanges the credential and prints exactly the Authorization header, writing nothing', async () => {
  const { h, cleanup } = home()
  try {
    await withHub(async hub => {
      const before = listing(h)
      const r = await run(nodeEnv(h, hub))
      assert.equal(r.code, 0, r.stderr)
      assert.equal(r.stdout, `{"Authorization":"Bearer ${MCP}"}`)
      assert.equal(r.stderr, '')
      const call = hub.log.find(l => l.path === '/api/up/mcp-token')
      assert.equal(call.method, 'POST')
      assert.equal(call.auth, `Bearer ${SLK}`)
      assert.deepEqual(listing(h), before, 'the MCP token is never stored')
      assert.ok(!r.argv.includes(SLK))
    })
  } finally { cleanup() }
})

test('with Node: no credential file, or a malformed one, fails closed before any request', async () => {
  for (const token of [null, 'not-a-link-token']) {
    const { h, cleanup } = home({ token })
    try {
      await withHub(async hub => {
        const r = await run(nodeEnv(h, hub))
        assert.equal(r.code, 2)
        assert.equal(r.stdout, '')
        assert.match(r.stderr, /sielay-link\/token/)
        assert.equal(hub.log.length, 0)
      })
    } finally { cleanup() }
  }
})

test('with Node: a refusal or a non-token answer fails closed, and stderr never carries the credential', async () => {
  const cases = [
    [{ status: 403, body: { code: 'mcp_not_enabled' } }, /no tiene acceso al MCP/],
    [{ status: 429, body: { code: 'rate_limited' } }, /demasiados tokens/],
    [{ status: 200, body: { token: 'short' } }, /no es un token MCP/],
    [{ status: 500, body: {} }, /respondió 500/],
  ]
  for (const [reply, message] of cases) {
    const { h, cleanup } = home()
    try {
      await withHub(async hub => {
        Object.assign(hub.mcp, reply)
        const r = await run(nodeEnv(h, hub))
        assert.equal(r.code, 1)
        assert.equal(r.stdout, '')
        assert.match(r.stderr, message)
        assert.ok(!r.stderr.includes(SLK))
      })
    } finally { cleanup() }
  }
  const { h, cleanup } = home({ token: SLK.replace('A1', 'Z9') })
  try {
    await withHub(async hub => {
      const r = await run(nodeEnv(h, hub))
      assert.equal(r.code, 1)
      assert.match(r.stderr, /no reconoce la credencial/)
    })
  } finally { cleanup() }
})

// Without Node: a PATH with the few tools the sh helper uses and a curl shim that logs argv and stdin.
function noNodePath(dir, reply) {
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  for (const tool of ['dirname', 'grep', 'tr', 'tail', 'sed', 'head', 'cat']) {
    symlinkSync(execFileSync('sh', ['-c', `command -v ${tool}`]).toString().trim(), join(bin, tool))
  }
  writeFileSync(join(bin, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${dir}/curl.argv"\ncat >> "${dir}/curl.stdin"\nprintf '%s' '${reply}'\n`)
  chmodSync(join(bin, 'curl'), 0o755)
  return bin
}

test('without Node: sh + curl does the same exchange, with the credential on curl\'s stdin only', async () => {
  const { dir, h, cleanup } = home()
  try {
    const bin = noNodePath(dir, `{"token":"${MCP}","ttl_s":86400}\n200`)
    const r = await run({ PATH: bin, HOME: h })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.stdout, `{"Authorization":"Bearer ${MCP}"}`)
    const argv = readFileSync(join(dir, 'curl.argv'), 'utf8')
    assert.match(argv, /-H @- .*https:\/\/sielay\.cloud\/api\/up\/mcp-token/)
    assert.match(argv, /--proto =https/)
    assert.ok(!argv.includes(SLK), 'the credential is not in argv')
    assert.equal(readFileSync(join(dir, 'curl.stdin'), 'utf8'), `Authorization: Bearer ${SLK}\n`)
    assert.deepEqual(readdirSync(dir).sort(), ['bin', 'curl.argv', 'curl.stdin', 'home'])
  } finally { cleanup() }
})

test('a Node without fetch (older than 18) falls back to sh + curl', async () => {
  const { dir, h, cleanup } = home()
  try {
    const bin = noNodePath(dir, `{"token":"${MCP}"}\n200`)
    writeFileSync(join(bin, 'node'), '#!/bin/sh\necho "$*" >> "$(dirname "$0")/../node.argv"\nexit 1\n')
    chmodSync(join(bin, 'node'), 0o755)
    const r = await run({ PATH: bin, HOME: h })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.stdout, `{"Authorization":"Bearer ${MCP}"}`)
    assert.match(readFileSync(join(dir, 'node.argv'), 'utf8'), /typeof fetch/)
    assert.ok(readFileSync(join(dir, 'curl.argv'), 'utf8').includes('/api/up/mcp-token'))
  } finally { cleanup() }
})

test('without Node: no file → exit 2 before curl; a refusal or a non-token → exit 1', async () => {
  const missing = home({ token: null })
  try {
    const bin = noNodePath(missing.dir, 'x\n200')
    const r = await run({ PATH: bin, HOME: missing.h })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /no está .*sielay-link\/token; conéctala otra vez con: curl -fsSL https:\/\/sielay\.cloud\/up \| bash/)
    assert.deepEqual(readdirSync(missing.dir).sort(), ['bin', 'home'], 'curl never ran')
  } finally { missing.cleanup() }
  for (const [reply, message] of [['{"code":"mcp_not_enabled"}\n403', /no tiene acceso al MCP/], ['{"token":"abc"}\n200', /no es un token MCP/], ['{}\n401', /respondió 401/]]) {
    const { dir, h, cleanup } = home()
    try {
      const r = await run({ PATH: noNodePath(dir, reply), HOME: h })
      assert.equal(r.code, 1)
      assert.equal(r.stdout, '')
      assert.match(r.stderr, message)
      assert.ok(!r.stderr.includes(SLK))
    } finally { cleanup() }
  }
})

test('.mcp.json points the sielay server at the hub with this helper, and nothing else', () => {
  const mcp = JSON.parse(readFileSync(join(dirname(SH), '..', '.mcp.json'), 'utf8'))
  assert.deepEqual(mcp, { mcpServers: { sielay: { type: 'http', url: 'https://sielay.cloud/mcp', headersHelper: 'sh "${CLAUDE_PLUGIN_ROOT}/bin/sielay-mcp-headers.sh"' } } })
})
