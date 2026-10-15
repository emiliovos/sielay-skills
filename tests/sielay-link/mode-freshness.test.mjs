import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  modeState,
  IDLE_POLICY,
  IDLE_POLICY_LAST_SEEN,
  IDLE_POLICY_STRICT,
  IDLE_FRESH_MAX_MS,
} from '../../plugins/sielay-link/mod/link-mode-freshness.js'

const H = 3_600_000
const bypass = (at, event = 'PostToolUse') => ({ mode: 'bypassPermissions', at, event })

test('the default idle policy is "last seen mode" with a 12 h window', () => {
  assert.equal(IDLE_POLICY, IDLE_POLICY_LAST_SEEN)
  assert.equal(IDLE_FRESH_MAX_MS, 12 * H)
})

for (const policy of [IDLE_POLICY_STRICT, IDLE_POLICY_LAST_SEEN]) {
  test(`[${policy}] no samples: unknown and not fresh`, () => {
    const s = modeState({ samples: [], lastStopAt: null, liveSource: undefined, now: 1000, policy })
    assert.deepEqual(s, { mode: 'unknown', fresh: false, state: 'unknown', ageMs: null })
  })

  test(`[${policy}] a sample in the running turn is fresh`, () => {
    const samples = [bypass(100, 'Stop'), bypass(500, 'UserPromptSubmit'), bypass(700)]
    const s = modeState({ samples, lastStopAt: 100, now: 800, policy })
    assert.equal(s.mode, 'bypassPermissions')
    assert.equal(s.fresh, true)
    assert.equal(s.state, 'working')
    assert.equal(s.ageMs, 100)
  })

  test(`[${policy}] a turn with no Stop yet is fresh`, () => {
    const s = modeState({ samples: [bypass(10, 'UserPromptSubmit')], lastStopAt: null, now: 20, policy })
    assert.equal(s.fresh, true)
    assert.equal(s.state, 'working')
  })

  test(`[${policy}] a live source wins and is fresh`, () => {
    const s = modeState({ samples: [bypass(10, 'Stop')], lastStopAt: 10, liveSource: 'default', now: 20, policy })
    assert.deepEqual({ mode: s.mode, fresh: s.fresh }, { mode: 'default', fresh: true })
  })

  test(`[${policy}] the newest sample decides, whatever the array order`, () => {
    const samples = [{ mode: 'default', at: 900, event: 'UserPromptSubmit' }, bypass(100)]
    const s = modeState({ samples, lastStopAt: 50, now: 950, policy })
    assert.equal(s.mode, 'default')
  })
}

test('[strict] idle after Stop without a live source is not fresh', () => {
  const s = modeState({ samples: [bypass(100, 'Stop')], lastStopAt: 100, now: 101, policy: IDLE_POLICY_STRICT })
  assert.equal(s.mode, 'bypassPermissions')
  assert.equal(s.fresh, false)
  assert.equal(s.state, 'idle')
  assert.equal(s.ageMs, 1)
})

test('[last seen] idle bypass stays fresh up to 12 h, then goes stale', () => {
  const at = 1_000
  const inWindow = modeState({ samples: [bypass(at, 'Stop')], lastStopAt: at, now: at + IDLE_FRESH_MAX_MS, policy: IDLE_POLICY_LAST_SEEN })
  assert.equal(inWindow.fresh, true)
  assert.equal(inWindow.state, 'idle')
  const stale = modeState({ samples: [bypass(at, 'Stop')], lastStopAt: at, now: at + IDLE_FRESH_MAX_MS + 1, policy: IDLE_POLICY_LAST_SEEN })
  assert.equal(stale.fresh, false)
  assert.equal(stale.ageMs, IDLE_FRESH_MAX_MS + 1)
})

test('[last seen] idle in a non-bypass mode is never fresh', () => {
  const s = modeState({ samples: [{ mode: 'default', at: 5, event: 'Stop' }], lastStopAt: 5, now: 6, policy: IDLE_POLICY_LAST_SEEN })
  assert.equal(s.fresh, false)
  assert.equal(s.mode, 'default')
})

test('a clock that went backwards never yields a negative age or freshness', () => {
  const s = modeState({ samples: [bypass(5_000, 'Stop')], lastStopAt: 5_000, now: 1_000, policy: IDLE_POLICY_LAST_SEEN })
  assert.equal(s.ageMs, 0)
})

test('malformed samples are ignored', () => {
  const samples = [null, { mode: 7, at: 1 }, { mode: 'bypassPermissions' }, bypass(3, 'UserPromptSubmit')]
  const s = modeState({ samples, lastStopAt: null, now: 4, policy: IDLE_POLICY_STRICT })
  assert.equal(s.fresh, true)
})

test('an unknown policy falls back to strict (fail closed)', () => {
  const s = modeState({ samples: [bypass(1, 'Stop')], lastStopAt: 1, now: 2, policy: 'whatever' })
  assert.equal(s.fresh, false)
})
