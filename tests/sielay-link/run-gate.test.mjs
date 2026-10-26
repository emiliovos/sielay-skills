import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldInject, onStripAccept, onStripReject } from '../../plugins/sielay-link/mod/link-run-gate.js'

const fresh = { mode: 'bypassPermissions', fresh: true }

test('run=1 with fresh bypass injects', () => {
  assert.equal(shouldInject({ delivery: { run: 1, gate: 'auto' }, mode: fresh }), true)
})

test('run=1 with stale bypass goes to the strip', () => {
  assert.equal(shouldInject({ delivery: { run: 1, gate: 'auto' }, mode: { mode: 'bypassPermissions', fresh: false } }), false)
})

test('run=1 with fresh auto mode injects; stale auto goes to the strip', () => {
  assert.equal(shouldInject({ delivery: { run: 1, gate: 'auto' }, mode: { mode: 'auto', fresh: true } }), true)
  assert.equal(shouldInject({ delivery: { run: 1, gate: 'auto' }, mode: { mode: 'auto', fresh: false } }), false)
})

for (const mode of ['default', 'acceptEdits', 'plan', 'unknown']) {
  test(`run=1 in ${mode} goes to the strip`, () => {
    assert.equal(shouldInject({ delivery: { run: 1, gate: 'auto' }, mode: { mode, fresh: true } }), false)
  })
}

test('run=0 goes to the strip even in fresh bypass', () => {
  assert.equal(shouldInject({ delivery: { run: 0, gate: 'auto' }, mode: fresh }), false)
})

test('a truthy run that is not exactly 1 does not inject', () => {
  for (const run of ['1', true, 2, undefined, null]) {
    assert.equal(shouldInject({ delivery: { run, gate: 'auto' }, mode: fresh }), false, String(run))
  }
})

test('fresh must be exactly true', () => {
  assert.equal(shouldInject({ delivery: { run: 1, gate: 'auto' }, mode: { mode: 'bypassPermissions', fresh: 1 } }), false)
})

test('Accept in the strip decides accepted and injects, whatever the mode', () => {
  assert.deepEqual(onStripAccept({ id: 'm1', run: 0 }), { decide: 'accepted', inject: true })
})

test('Reject in the strip decides rejected and never injects', () => {
  assert.deepEqual(onStripReject({ id: 'm1' }), { decide: 'rejected', inject: false })
})

test('an accepted message redelivered by the hub (run=1, gate=accepted) injects in any mode: a person already accepted it', () => {
  for (const mode of [fresh, { mode: 'default', fresh: false }, { mode: 'unknown', fresh: false }]) {
    assert.equal(shouldInject({ delivery: { run: 1, gate: 'accepted' }, mode }), true, mode.mode)
  }
  assert.equal(shouldInject({ delivery: { run: 0, gate: 'accepted' }, mode: fresh }), false, 'only with run=1')
})

test('run=1 with a gate that is neither auto nor accepted never injects (defence against a hub bug)', () => {
  for (const gate of ['strip', 'held', 'rejected', undefined]) {
    assert.equal(shouldInject({ delivery: { run: 1, gate }, mode: fresh }), false, String(gate))
  }
})
