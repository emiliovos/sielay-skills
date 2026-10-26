// The mode across a /clear: the host empties `$.state` and session.start does
// not run again, so the last sample seen is carried in memory and restored
// into the new conversation. A shift+tab seen before the /clear wins, the
// sample keeps its age (the 24 h cap still applies) and nothing is invented.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carryModeOnClear, restoreModeCarry, latestSample } from '../../plugins/sielay-link/mod/link-mode-carry.js'
import { readMode } from '../../plugins/sielay-link/mod/link-session-payload.js'
import { MODE_FRESH_MAX_MS } from '../../plugins/sielay-link/mod/link-mode-freshness.js'

const NOW = 10_000_000

function engine({ samples = [], lastStopAt = null, now = NOW, getThrows = false } = {}) {
  const state = { modeSamples: samples, lastStopAt }
  const versions = { modeSamples: 1, lastStopAt: 1 }
  const logs = []
  const clock = { at: now }
  const $ = {
    clock: { now: async () => clock.at },
    state: {
      get: async ref => { if (getThrows) throw new Error('boom'); return { value: state[ref.key] ?? undefined, version: versions[ref.key] ?? 0 } },
      set: async (ref, value, opts = {}) => {
        if (opts.ifVersion !== undefined && opts.ifVersion !== (versions[ref.key] ?? 0)) return { isSet: false, version: versions[ref.key] }
        state[ref.key] = value
        versions[ref.key] = (versions[ref.key] ?? 0) + 1
        return { isSet: true, version: versions[ref.key] }
      },
    },
    ui: { log: t => void logs.push(t) },
  }
  /** What the host does on /clear or /resume: another session, its state empty. */
  const clear = () => { state.modeSamples = undefined; state.lastStopAt = undefined; versions.modeSamples = 0; versions.lastStopAt = 0 }
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
      { mode: 'default', at: NOW - 20_000, event: 'UserPromptSubmit' },
    ],
    lastStopAt: NOW - 10_000,
  })
  const rt = runtime()
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  h.clear()
  await restoreModeCarry(h.$, rt)
  assert.deepEqual(h.state.modeSamples, [{ mode: 'default', at: NOW - 20_000, event: 'UserPromptSubmit' }])
  assert.equal((await readMode(h.$)).fresh, false)
})

test('an auto sample seen by a hook survives /clear and stays fresh', async () => {
  const h = engine({ samples: [{ mode: 'auto', at: NOW - 20_000, event: 'Stop' }], lastStopAt: NOW - 20_000 })
  const rt = runtime()
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  h.clear()
  await restoreModeCarry(h.$, rt)
  const m = await readMode(h.$)
  assert.deepEqual([m.mode, m.fresh], ['auto', true])
})

test('the carried sample keeps its age: past the 24 h cap it is not fresh', async () => {
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

test('before the host swaps the session the carry waits; a new conversation that spoke first drops it', async () => {
  const h = engine({ samples: [{ mode: 'bypassPermissions', at: NOW - 1_000, event: 'Stop' }], lastStopAt: NOW - 1_000 })
  const rt = runtime()
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  await restoreModeCarry(h.$, rt) // a poll before the swap: the old conversation's samples
  assert.notEqual(rt.modeCarry, null)
  h.clear()
  h.state.modeSamples = [{ mode: 'default', at: NOW, event: 'UserPromptSubmit' }]
  await restoreModeCarry(h.$, rt)
  assert.deepEqual(h.state.modeSamples, [{ mode: 'default', at: NOW, event: 'UserPromptSubmit' }])
  assert.equal(rt.modeCarry, null)
})

test('a carry never reaches a later /resume: the conversation resumed reports unknown', async () => {
  const h = engine({ samples: [{ mode: 'bypassPermissions', at: NOW - 1_000, event: 'Stop' }], lastStopAt: NOW - 1_000 })
  const rt = runtime()
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  h.clear()
  h.state.modeSamples = [{ mode: 'default', at: NOW, event: 'UserPromptSubmit' }] // spoke before any restore, then shift+tab
  await carryModeOnClear(h.$, rt, { reason: 'resume' })
  h.clear()
  await restoreModeCarry(h.$, rt)
  assert.equal((await readMode(h.$)).mode, 'unknown')
})

test('a sample recorded while restoring wins over the carried one', async () => {
  const h = engine({ samples: [{ mode: 'bypassPermissions', at: NOW - 1_000, event: 'Stop' }], lastStopAt: NOW - 1_000 })
  const rt = runtime()
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  h.clear()
  const prompt = [{ mode: 'default', at: NOW, event: 'UserPromptSubmit' }]
  const get = h.$.state.get
  h.$.state.get = async ref => {
    const read = await get(ref)
    if (ref.key === 'modeSamples') {
      h.$.state.get = get
      await h.$.state.set(ref, prompt) // the prompt lands between the read and the write
    }
    return read
  }
  await restoreModeCarry(h.$, rt)
  assert.deepEqual(h.state.modeSamples, prompt)
  assert.equal(h.state.lastStopAt, undefined)
  assert.equal(rt.modeCarry, null)
})

test('a failed state read never throws, carries nothing and logs once', async () => {
  const h = engine({ getThrows: true })
  const rt = { modeCarry: { sample: { mode: 'bypassPermissions', at: NOW, event: 'Stop' }, lastStopAt: NOW } }
  await carryModeOnClear(h.$, rt, { reason: 'clear' })
  assert.equal(rt.modeCarry, null)
  rt.modeCarry = { sample: { mode: 'bypassPermissions', at: NOW, event: 'Stop' }, lastStopAt: NOW }
  await restoreModeCarry(h.$, rt)
  await restoreModeCarry(h.$, rt)
  assert.equal(rt.modeCarry, null)
  assert.equal(h.logs.length, 2)
})

test('latestSample skips malformed entries', () => {
  assert.equal(latestSample(undefined), null)
  assert.equal(latestSample([null, { mode: '', at: 1 }, { mode: 'plan', at: Number.NaN }]), null)
  assert.deepEqual(latestSample([{ mode: 'plan', at: 2 }, { mode: 'default', at: 1, event: 'Stop' }]), { mode: 'plan', at: 2, event: '' })
})
