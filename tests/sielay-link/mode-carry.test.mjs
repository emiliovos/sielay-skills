// The mode across a /clear: the host empties `$.state` and session.start does
// not run again, so the last sample seen is carried in memory and restored
// into the new conversation. A shift+tab seen before the /clear wins, the
// sample keeps its age (the 12 h cap still applies) and nothing is invented.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carryModeOnClear, restoreModeCarry, latestSample } from '../../plugins/sielay-link/mod/link-mode-carry.js'
import { readMode } from '../../plugins/sielay-link/mod/link-session-payload.js'
import { MODE_FRESH_MAX_MS } from '../../plugins/sielay-link/mod/link-mode-freshness.js'

const NOW = 10_000_000

function engine({ samples = [], lastStopAt = null, now = NOW, getThrows = false } = {}) {
  const state = { modeSamples: samples, lastStopAt }
  const logs = []
  const clock = { at: now }
  const $ = {
    clock: { now: async () => clock.at },
    state: {
      get: async ref => { if (getThrows) throw new Error('boom'); return { value: state[ref.key] ?? undefined, version: 0 } },
      set: async (ref, value) => { state[ref.key] = value; return { isSet: true, version: 1 } },
    },
    ui: { log: t => void logs.push(t) },
  }
  /** What the host does on /clear: a new session with empty state. */
  const clear = () => { state.modeSamples = undefined; state.lastStopAt = undefined }
  return { $, state, logs, clock, clear }
}
const runtime = () => ({ modeCarry: null })

test('a session in bypass stays fresh bypass and idle after /clear', async () => {
  const h = engine({ samples: [{ mode: 'bypassPermissions', at: NOW - 60_000, event: 'SessionStart' }], lastStopAt: NOW - 60_000 })
  const rt = runtime()
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  h.clear()
  assert.equal((await readMode(h.$)).mode, 'unknown') // the bug: nothing to report
  await restoreModeCarry(h.$, rt)
  assert.deepEqual(await readMode(h.$), { mode: 'bypassPermissions', fresh: true, state: 'idle', ageMs: 60_000 })
  assert.equal(rt.modeCarry, null)
})

test('a shift+tab seen before /clear wins: the newest sample is the one carried', async () => {
  const h = engine({
    samples: [
      { mode: 'bypassPermissions', at: NOW - 90_000, event: 'SessionStart' },
      { mode: 'auto', at: NOW - 20_000, event: 'UserPromptSubmit' },
    ],
    lastStopAt: NOW - 10_000,
  })
  const rt = runtime()
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  h.clear()
  await restoreModeCarry(h.$, rt)
  assert.deepEqual(h.state.modeSamples, [{ mode: 'auto', at: NOW - 20_000, event: 'UserPromptSubmit' }])
  assert.equal((await readMode(h.$)).fresh, false)
})

test('the carried sample keeps its age: past the 12 h cap it is not fresh', async () => {
  const at = NOW - MODE_FRESH_MAX_MS - 1
  const h = engine({ samples: [{ mode: 'bypassPermissions', at, event: 'Stop' }], lastStopAt: at })
  const rt = runtime()
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  h.clear()
  await restoreModeCarry(h.$, rt)
  assert.equal(h.state.modeSamples[0].at, at)
  assert.equal((await readMode(h.$)).fresh, false)
})

test('a turn that never marked its end is restored as idle, not working', async () => {
  const h = engine({ samples: [{ mode: 'bypassPermissions', at: NOW - 5_000, event: 'PostToolUse' }], lastStopAt: NOW - 50_000 })
  const rt = runtime()
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  h.clear()
  await restoreModeCarry(h.$, rt)
  assert.equal(h.state.lastStopAt, NOW - 5_000)
  assert.equal((await readMode(h.$)).state, 'idle')
})

test('only /clear carries: an exit or a resume leaves nothing', async () => {
  for (const reason of ['other', 'resume', 'logout', 'prompt_input_exit', undefined]) {
    const h = engine({ samples: [{ mode: 'bypassPermissions', at: NOW, event: 'Stop' }] })
    const rt = runtime()
    await carryModeOnClear(h.$, rt, { reason })
    assert.equal(rt.modeCarry, null, String(reason))
  }
})

test('nothing seen before /clear: nothing is restored', async () => {
  const h = engine()
  const rt = runtime()
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  assert.equal(rt.modeCarry, null)
  h.clear()
  await restoreModeCarry(h.$, rt)
  assert.equal((await readMode(h.$)).mode, 'unknown')
})

test('a session that already has a sample keeps it, and the carry waits for the swap', async () => {
  const h = engine({ samples: [{ mode: 'bypassPermissions', at: NOW - 1_000, event: 'Stop' }], lastStopAt: NOW - 1_000 })
  const rt = runtime()
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  await restoreModeCarry(h.$, rt) // a poll before the host swapped the session
  assert.notEqual(rt.modeCarry, null)
  h.clear()
  h.state.modeSamples = [{ mode: 'default', at: NOW, event: 'UserPromptSubmit' }] // the new conversation spoke first
  await restoreModeCarry(h.$, rt)
  assert.deepEqual(h.state.modeSamples, [{ mode: 'default', at: NOW, event: 'UserPromptSubmit' }])
})

test('a failed state read never throws and carries nothing', async () => {
  const h = engine({ getThrows: true })
  const rt = { modeCarry: { sample: { mode: 'bypassPermissions', at: NOW, event: 'Stop' }, lastStopAt: NOW } }
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  assert.equal(rt.modeCarry, null)
  rt.modeCarry = { sample: { mode: 'bypassPermissions', at: NOW, event: 'Stop' }, lastStopAt: NOW }
  await restoreModeCarry(h.$, rt)
  assert.equal(h.logs.length, 2)
})

test('latestSample skips malformed entries', () => {
  assert.equal(latestSample(undefined), null)
  assert.equal(latestSample([null, { mode: '', at: 1 }, { mode: 'plan', at: Number.NaN }]), null)
  assert.deepEqual(latestSample([{ mode: 'plan', at: 2 }, { mode: 'default', at: 1, event: 'Stop' }]), { mode: 'plan', at: 2, event: '' })
})
