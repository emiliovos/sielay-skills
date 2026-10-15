import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, statSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDeliveryAdapter as createAdapterFor } from '../../plugins/sielay-link/mod/link-delivery-adapter.js'

// The adapter takes `$` first; tests hand it a fake with `process.run` and `prompt.submit`.
const createDeliveryAdapter = ({ proc, helperPath, submitPrompt }) =>
  createAdapterFor({ process: { run: (argv, init) => proc.run(argv, init) }, prompt: { submit: ({ text }) => submitPrompt(text) } }, { helperPath })

function fakeProc(answer) {
  const calls = []
  return {
    calls,
    run: async (argv, init = {}) => {
      calls.push({ argv, init })
      return answer(argv, init)
    },
  }
}

const HELPER = '/plugin/bin/sielay-link-socket-write.mjs'

test('detect: node present → socket; missing or failing → prompt', async () => {
  const yes = createDeliveryAdapter({ proc: fakeProc(() => ({ exitCode: 0, stdout: 'v22.1.0\n', stderr: '' })), helperPath: HELPER, submitPrompt: async () => {} })
  assert.equal(await yes.detect(), 'socket')
  const no = createDeliveryAdapter({ proc: fakeProc(() => { throw new Error('ENOENT') }), helperPath: HELPER, submitPrompt: async () => {} })
  assert.equal(await no.detect(), 'prompt')
  const odd = createDeliveryAdapter({ proc: fakeProc(() => ({ exitCode: 127, stdout: '', stderr: '' })), helperPath: HELPER, submitPrompt: async () => {} })
  assert.equal(await odd.detect(), 'prompt')
})

test('socket inject: runs node + helper with the text on stdin only', async () => {
  const proc = fakeProc(() => ({ exitCode: 0, stdout: '{"ok":true}\n', stderr: '' }))
  const prompts = []
  const a = createDeliveryAdapter({ proc, helperPath: HELPER, submitPrompt: async t => prompts.push(t) })
  assert.deepEqual(await a.inject('[sielay-link …]\n\nhola'), { via: 'socket' })
  assert.deepEqual(proc.calls[0].argv, ['node', HELPER])
  assert.deepEqual(JSON.parse(proc.calls[0].init.stdin), { content: '[sielay-link …]\n\nhola' })
  assert.equal(prompts.length, 0)
})

test('socket inject falls back to the prompt only when nothing was written', async () => {
  for (const code of ['no_socket', 'no_token', 'connect_failed']) {
    const prompts = []
    const a = createDeliveryAdapter({ proc: fakeProc(() => ({ exitCode: 2, stdout: JSON.stringify({ ok: false, code }), stderr: '' })), helperPath: HELPER, submitPrompt: async t => prompts.push(t) })
    assert.deepEqual(await a.inject('x'), { via: 'prompt' }, code)
    assert.deepEqual(prompts, ['x'])
  }
})

test('a write failure after connecting throws instead of risking a duplicate', async () => {
  const prompts = []
  const a = createDeliveryAdapter({ proc: fakeProc(() => ({ exitCode: 1, stdout: '{"ok":false,"code":"write_failed"}', stderr: '' })), helperPath: HELPER, submitPrompt: async t => prompts.push(t) })
  await assert.rejects(a.inject('x'), /write_failed/)
  assert.equal(prompts.length, 0)
})

test('prompt mode submits the text', async () => {
  const prompts = []
  const a = createDeliveryAdapter({ proc: fakeProc(() => { throw new Error('ENOENT') }), helperPath: HELPER, submitPrompt: async t => prompts.push(t) })
  await a.detect()
  assert.deepEqual(await a.inject('y'), { via: 'prompt' })
  assert.deepEqual(prompts, ['y'])
})

test('empty text is refused', async () => {
  const a = createDeliveryAdapter({ proc: fakeProc(() => ({ exitCode: 0, stdout: '{"ok":true}', stderr: '' })), helperPath: HELPER, submitPrompt: async () => {} })
  await assert.rejects(a.inject(''), /nothing/)
})

test('token file: token on stdin, never in argv; real sh writes a 0600 file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'slk-tok-'))
  try {
    const realProc = {
      calls: [],
      async run(argv, init) {
        this.calls.push({ argv, init })
        const r = spawnSync(argv[0], argv.slice(1), { input: init.stdin })
        return { exitCode: r.status ?? 1, stdout: String(r.stdout), stderr: String(r.stderr) }
      },
    }
    const a = createDeliveryAdapter({ proc: realProc, helperPath: HELPER, submitPrompt: async () => {} })
    const path = join(dir, 'nested', 'token')
    await a.writeTokenFile(path, 'secret-for-test')
    assert.equal(readFileSync(path, 'utf8'), 'secret-for-test')
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.equal(statSync(join(dir, 'nested')).mode & 0o777, 0o700)
    // An older, world-readable file is replaced, never written into.
    chmodSync(path, 0o644)
    await a.writeTokenFile(path, 'second-secret')
    assert.equal(readFileSync(path, 'utf8'), 'second-secret')
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.ok(!realProc.calls[0].argv.some(x => x.includes('secret-for-test')))
    await assert.rejects(a.writeTokenFile('relative/token', 't'), /absolute/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tmux name only inside tmux, trimmed; hostname trimmed', async () => {
  const proc = fakeProc(argv => ({ exitCode: 0, stdout: argv[0] === 'tmux' ? 'api\n' : 'box-1\n', stderr: '' }))
  const a = createDeliveryAdapter({ proc, helperPath: HELPER, submitPrompt: async () => {} })
  assert.equal(await a.tmuxSessionName(undefined), undefined)
  assert.equal(proc.calls.length, 0)
  assert.equal(await a.tmuxSessionName('/tmp/tmux-1/default,1,0'), 'api')
  assert.equal(await a.hostname(), 'box-1')
})
