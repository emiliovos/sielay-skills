// The launch mode: a session started in bypass reports it (fresh, idle) from
// its first poll instead of `unknown` until its first prompt; a reload never
// overwrites a mode already seen; a failed reading changes nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pidFromSocket, modeFromArgs, launchMode, recordLaunchMode } from '../../plugins/sielay-link/mod/link-launch-mode.js'
import { readMode } from '../../plugins/sielay-link/mod/link-session-payload.js'
import { createDeliveryAdapter } from '../../plugins/sielay-link/mod/link-delivery-adapter.js'

test('pidFromSocket reads the PID from the socket name only', () => {
  assert.equal(pidFromSocket('/run/user/1000/cc-socks/3798747.sock'), '3798747')
  assert.equal(pidFromSocket(undefined), undefined)
  assert.equal(pidFromSocket('/tmp/x.sock'), undefined)
  assert.equal(pidFromSocket('/tmp/12;rm.sock'), undefined)
})

test('modeFromArgs: skip-permissions, --permission-mode in both spellings, unknown values ignored', () => {
  assert.equal(modeFromArgs('claude --dangerously-skip-permissions --resume abc'), 'bypassPermissions')
  assert.equal(modeFromArgs('claude --permission-mode plan'), 'plan')
  assert.equal(modeFromArgs('claude --permission-mode=acceptEdits'), 'acceptEdits')
  assert.equal(modeFromArgs('claude --permission-mode yolo'), undefined)
  assert.equal(modeFromArgs('claude --allow-dangerously-skip-permissions'), undefined)
  assert.equal(modeFromArgs('claude'), undefined)
})

test('launchMode: command line, then settings defaultMode, then default only when the command line was read', () => {
  assert.equal(launchMode({ args: 'claude --dangerously-skip-permissions', defaultMode: 'plan' }), 'bypassPermissions')
  assert.equal(launchMode({ args: 'claude', defaultMode: 'bypassPermissions' }), 'bypassPermissions')
  assert.equal(launchMode({ args: 'claude', defaultMode: 'nonsense' }), 'default')
  assert.equal(launchMode({ args: undefined, defaultMode: 'acceptEdits' }), 'acceptEdits')
  assert.equal(launchMode({ args: undefined, defaultMode: undefined }), undefined)
})

function engine({ samples = [], socket = '/run/user/1000/cc-socks/4242.sock', defaultMode, settingsThrow = false } = {}) {
  const state = { modeSamples: samples, lastStopAt: null }
  const logs = []
  const $ = {
    clock: { now: async () => 5_000_000 },
    env: { get: async name => (name === 'CLAUDE_CODE_MESSAGING_SOCKET' ? socket : undefined) },
    settings: { read: async () => { if (settingsThrow) throw new Error('boom'); return defaultMode ? { defaultMode } : undefined } },
    state: {
      get: async ref => ({ value: state[ref.key] ?? undefined, version: 0 }),
      set: async (ref, value) => { state[ref.key] = value; return { isSet: true, version: 1 } },
    },
    ui: { log: t => void logs.push(t) },
  }
  return { $, state, logs }
}
const adapterFor = (args, seen = []) => ({ processArgs: async pid => { seen.push(pid); return args } })

test('a session launched in bypass is fresh bypass and idle at once', async () => {
  const h = engine()
  const seen = []
  await recordLaunchMode(h.$, adapterFor('claude --dangerously-skip-permissions', seen))
  assert.deepEqual(seen, ['4242'])
  assert.deepEqual(h.state.modeSamples, [{ mode: 'bypassPermissions', at: 5_000_000, event: 'SessionStart' }])
  assert.equal(h.state.lastStopAt, 5_000_000)
  assert.deepEqual(await readMode(h.$), { mode: 'bypassPermissions', fresh: true, state: 'idle', ageMs: 0 })
})

test('a reload keeps the mode already seen: nothing is recorded over existing samples', async () => {
  const seen = [{ mode: 'default', at: 4_000_000, event: 'Stop' }]
  const h = engine({ samples: seen })
  const calls = []
  await recordLaunchMode(h.$, adapterFor('claude --dangerously-skip-permissions', calls))
  assert.deepEqual(h.state.modeSamples, seen)
  assert.deepEqual(calls, [])
})

test('without a socket the settings defaultMode decides; with nothing known nothing is recorded', async () => {
  const a = engine({ socket: null, defaultMode: 'bypassPermissions' })
  await recordLaunchMode(a.$, adapterFor('claude --permission-mode plan'))
  assert.equal(a.state.modeSamples[0].mode, 'bypassPermissions')
  const b = engine({ socket: null })
  await recordLaunchMode(b.$, adapterFor('claude'))
  assert.deepEqual(b.state.modeSamples, [])
  assert.equal(b.state.lastStopAt, null)
})

test('a launch without flags or defaultMode is default: never auto-runs', async () => {
  const h = engine()
  await recordLaunchMode(h.$, adapterFor('claude --resume abc'))
  assert.equal((await readMode(h.$)).fresh, false)
  assert.equal(h.state.modeSamples[0].mode, 'default')
})

test('a failing settings read still uses the command line; a throwing adapter logs only the error kind', async () => {
  const a = engine({ settingsThrow: true })
  await recordLaunchMode(a.$, adapterFor('claude --dangerously-skip-permissions'))
  assert.equal(a.state.modeSamples[0].mode, 'bypassPermissions')
  const b = engine()
  await recordLaunchMode(b.$, { processArgs: async () => { throw new TypeError('ruta-secreta') } })
  assert.deepEqual(b.state.modeSamples, [])
  assert.equal(b.logs.length, 1)
  assert.doesNotMatch(b.logs[0], /ruta-secreta/)
})

test('the adapter reads the command line with ps, PID as its own argv entry, digits only', async () => {
  const runs = []
  const $ = { process: { run: async (argv, init) => { runs.push({ argv, init }); return { exitCode: 0, stdout: 'claude --dangerously-skip-permissions\n', stderr: '' } } } }
  const adapter = createDeliveryAdapter($, { helperPath: '/x' })
  assert.equal(await adapter.processArgs('4242'), 'claude --dangerously-skip-permissions')
  assert.deepEqual(runs[0].argv, ['ps', '-o', 'args=', '-p', '4242'])
  assert.equal(await adapter.processArgs('42; rm -rf /'), undefined)
  assert.equal(runs.length, 1)
  $.process.run = async () => ({ exitCode: 1, stdout: '', stderr: 'no such process' })
  assert.equal(await adapter.processArgs('4242'), undefined)
})
