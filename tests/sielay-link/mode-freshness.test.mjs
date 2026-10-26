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

test('the default idle policy is "last seen mode" with a 24 h window', () => {
  assert.equal(IDLE_POLICY, IDLE_POLICY_LAST_SEEN)
  assert.equal(IDLE_FRESH_MAX_MS, 24 * H)
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

test('[last seen] idle bypass stays fresh up to 24 h, then goes stale', () => {
  const at = 1_000
  const inWindow = modeState({ samples: [bypass(at, 'Stop')], lastStopAt: at, now: at + IDLE_FRESH_MAX_MS, policy: IDLE_POLICY_LAST_SEEN })
  assert.equal(inWindow.fresh, true)
  assert.equal(inWindow.state, 'idle')
  const stale = modeState({ samples: [bypass(at, 'Stop')], lastStopAt: at, now: at + IDLE_FRESH_MAX_MS + 1, policy: IDLE_POLICY_LAST_SEEN })
  assert.equal(stale.fresh, false)
  assert.equal(stale.ageMs, IDLE_FRESH_MAX_MS + 1)
})

test('[last seen] idle in default, plan or acceptEdits is never fresh', () => {
  for (const mode of ['default', 'plan', 'acceptEdits']) {
    const s = modeState({ samples: [{ mode, at: 5, event: 'Stop' }], lastStopAt: 5, now: 6, policy: IDLE_POLICY_LAST_SEEN })
    assert.equal(s.fresh, false, mode)
    assert.equal(s.mode, mode)
  }
})

test('[last seen] idle auto mode counts like bypass: fresh up to 24 h, then stale', () => {
  const auto = { mode: 'auto', at: 1_000, event: 'Stop' }
  const inWindow = modeState({ samples: [auto], lastStopAt: 1_000, now: 1_000 + IDLE_FRESH_MAX_MS, policy: IDLE_POLICY_LAST_SEEN })
  assert.deepEqual([inWindow.mode, inWindow.fresh, inWindow.state], ['auto', true, 'idle'])
  const stale = modeState({ samples: [auto], lastStopAt: 1_000, now: 1_001 + IDLE_FRESH_MAX_MS, policy: IDLE_POLICY_LAST_SEEN })
  assert.equal(stale.fresh, false)
})

test('[last seen] auto asked for at launch is not fresh until a hook shows it; bypass at launch is', () => {
  const launchAuto = modeState({ samples: [{ mode: 'auto', at: 5, event: 'SessionStart' }], lastStopAt: 5, now: 6, policy: IDLE_POLICY_LAST_SEEN })
  assert.deepEqual([launchAuto.mode, launchAuto.fresh], ['auto', false])
  const seenAuto = modeState({ samples: [{ mode: 'auto', at: 5, event: 'SessionStart' }, { mode: 'auto', at: 9, event: 'Stop' }], lastStopAt: 9, now: 10, policy: IDLE_POLICY_LAST_SEEN })
  assert.equal(seenAuto.fresh, true)
  const launchBypass = modeState({ samples: [bypass(5, 'SessionStart')], lastStopAt: 5, now: 6, policy: IDLE_POLICY_LAST_SEEN })
  assert.equal(launchBypass.fresh, true)
})

test('[last seen] a bypass session idle for a night (14 h) stays fresh', () => {
  const s = modeState({ samples: [bypass(0, 'Stop')], lastStopAt: 0, now: 14 * H, policy: IDLE_POLICY_LAST_SEEN })
  assert.equal(s.fresh, true)
})

test('[strict] idle auto mode is not fresh either', () => {
  const s = modeState({ samples: [{ mode: 'auto', at: 5, event: 'Stop' }], lastStopAt: 5, now: 6, policy: IDLE_POLICY_STRICT })
  assert.equal(s.fresh, false)
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

// A turn that ends without a Stop (Esc, API error) must not stay fresh forever.
import { MODE_FRESH_MAX_MS } from '../../plugins/sielay-link/mod/link-mode-freshness.js'

for (const policy of [IDLE_POLICY_STRICT, IDLE_POLICY_LAST_SEEN]) {
  test(`[${policy}] a "running" turn with no Stop is capped at 24 h`, () => {
    const within = modeState({ samples: [bypass(0, 'UserPromptSubmit')], lastStopAt: null, now: MODE_FRESH_MAX_MS, policy })
    assert.equal(within.fresh, true)
    const later = modeState({ samples: [bypass(0, 'UserPromptSubmit')], lastStopAt: null, now: 25 * H, policy })
    assert.equal(later.fresh, false)
    assert.equal(later.state, 'unknown', 'a turn silent for 24 h is not reported as working')
  })

  test(`[${policy}] the review probe: a sample after an older Stop, 48 h later, is not fresh`, () => {
    const s = modeState({ samples: [bypass(10, 'PostToolUse')], lastStopAt: 5, now: 48 * H, policy })
    assert.equal(s.fresh, false)
  })
}

test('the 24 h cap is one constant shared by both branches', () => {
  assert.equal(MODE_FRESH_MAX_MS, IDLE_FRESH_MAX_MS)
})
