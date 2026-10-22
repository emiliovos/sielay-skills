// The `estimate` of session.build: the same limits and error names as the hub
// (contracts §1 and its amendment), checked through validateBuild.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateBuild } from '../../plugins/sielay-link/mod/link-build-validate.js'
import { estimate } from '../../plugins/sielay-link/mod/link-build-estimate.js'
import { BUILD_ESTIMATE_MAX_BYTES, BUILD_ESTIMATE_PHASES_MAX, BUILD_TEXT_MAX } from '../../plugins/sielay-link/mod/link-build-fields.js'

const NOW = Date.parse('2026-10-22T22:10:00.000Z')
const min = { build_id: 'sielay-261022-1555-build-tiempos', role: 'coordinator', stage: 3, status: 'waiting_approval' }
const sample = () => ({
  total_h: 7,
  phases: [{ name: 'Hub y API', h: 1.5 }, { name: 'Visor', h: 1.5 }],
  assumption: 'El VPS queda libre para merge-pr después de las 16:30',
  reason: 'revisión pidió otra vuelta',
})
/** @param {unknown} est */
const check = est => validateBuild({ ...min, estimate: est }, NOW)
/** @param {unknown} est */
const errorOf = est => check(est).error

test('the contract example comes back as sent, keys in a fixed order', () => {
  const { build, error } = check(sample())
  assert.equal(error, undefined)
  assert.deepEqual(build.estimate, sample())
  assert.deepEqual(Object.keys(build.estimate), ['total_h', 'phases', 'assumption', 'reason'])
})

test('only total_h: phases [] and the texts null, always present', () => {
  assert.deepEqual(check({ total_h: 3 }).build.estimate, { total_h: 3, phases: [], assumption: null, reason: null })
  assert.deepEqual(check({ total_h: 3, phases: null, assumption: '   ', reason: null }).build.estimate, { total_h: 3, phases: [], assumption: null, reason: null })
})

test('absent or null: the build carries no estimate', () => {
  assert.equal('estimate' in validateBuild(min, NOW).build, false)
  assert.equal('estimate' in check(null).build, false)
})

test('estimate must be an object', () => {
  for (const bad of [7, 'siete', [], true]) assert.equal(errorOf(bad), 'estimate', JSON.stringify(bad))
})

test('total_h: rounded to 0.1 first, then 0 < total_h ≤ 999', () => {
  assert.equal(check({ total_h: 2.345 }).build.estimate.total_h, 2.3)
  assert.equal(check({ total_h: 0.05 }).build.estimate.total_h, 0.1)
  assert.equal(check({ total_h: 999.04 }).build.estimate.total_h, 999)
  for (const bad of [0, 0.04, -1, 999.05, 1000, NaN, Infinity, '7', null, undefined]) {
    assert.equal(errorOf({ total_h: bad }), 'estimate.total_h', String(bad))
  }
  assert.equal(errorOf({}), 'estimate.total_h')
})

test('phases: an array of at most 20, each with a name and 0 ≤ h ≤ 999 after rounding', () => {
  const many = n => Array.from({ length: n }, (_, i) => ({ name: `f${i}`, h: 1 }))
  assert.equal(check({ total_h: 9, phases: many(BUILD_ESTIMATE_PHASES_MAX) }).build.estimate.phases.length, BUILD_ESTIMATE_PHASES_MAX)
  assert.equal(errorOf({ total_h: 9, phases: many(BUILD_ESTIMATE_PHASES_MAX + 1) }), 'estimate.phases')
  assert.equal(errorOf({ total_h: 9, phases: { name: 'x', h: 1 } }), 'estimate.phases')
  assert.equal(errorOf({ total_h: 9, phases: ['Hub'] }), 'estimate.phases')
  assert.deepEqual(check({ total_h: 9, phases: [{ name: ' Hub ', h: 0.04, extra: 1 }] }).build.estimate.phases, [{ name: 'Hub', h: 0 }])
  assert.equal(check({ total_h: 9, phases: [{ name: 'x', h: 999.04 }] }).build.estimate.phases[0].h, 999)
  for (const h of [-0.1, 999.05, NaN, '1', null, undefined]) assert.equal(errorOf({ total_h: 9, phases: [{ name: 'x', h }] }), 'estimate.phases', String(h))
})

test('phases[].name: required, scrubbed of secrets, capped at 80; empty after cleaning is refused', () => {
  const secret = 'slk_' + 'a'.repeat(24)
  const r = check({ total_h: 9, phases: [{ name: `Hub ${secret}`, h: 1 }, { name: 'n'.repeat(120), h: 1 }] })
  assert.equal(r.build.estimate.phases[0].name, 'Hub [secreto-removido]')
  assert.equal(r.build.estimate.phases[1].name.length, BUILD_TEXT_MAX.phase)
  for (const name of [undefined, null, '', '   ', 42]) assert.equal(errorOf({ total_h: 9, phases: [{ name, h: 1 }] }), 'estimate.phases', String(name))
})

test('assumption and reason: scrubbed, trimmed and capped at 200 and 120; a non-text names its field', () => {
  const secret = 'sk-' + 'b'.repeat(24)
  const r = check({ total_h: 9, assumption: ` ${'a'.repeat(300)} `, reason: `password=hunter2 ${'r'.repeat(200)}` })
  assert.equal(r.build.estimate.assumption.length, BUILD_TEXT_MAX.assumption)
  assert.equal(r.build.estimate.reason.length, BUILD_TEXT_MAX.reason)
  assert.ok(r.build.estimate.reason.startsWith('password=[secreto-removido]'))
  assert.ok(!JSON.stringify(check({ total_h: 9, assumption: secret }).build).includes(secret))
  assert.equal(errorOf({ total_h: 9, assumption: 7 }), 'estimate.assumption')
  assert.equal(errorOf({ total_h: 9, reason: ['x'] }), 'estimate.reason')
})

test('serialized over 2048 bytes is refused as estimate', () => {
  const wide = Array.from({ length: BUILD_ESTIMATE_PHASES_MAX }, (_, i) => ({ name: `${i}`.padEnd(BUILD_TEXT_MAX.phase, 'é'), h: 1 }))
  assert.equal(errorOf({ total_h: 9, phases: wide }), 'estimate')
  assert.ok(Buffer.byteLength(JSON.stringify(wide)) > BUILD_ESTIMATE_MAX_BYTES)
  const fits = wide.slice(0, 5)
  assert.equal(errorOf({ total_h: 9, phases: fits }), undefined)
})

test('estimate() alone: undefined when absent, the normalized object otherwise', () => {
  assert.equal(estimate(undefined), undefined)
  assert.equal(estimate(null), undefined)
  assert.deepEqual(estimate({ total_h: 1.26 }), { total_h: 1.3, phases: [], assumption: null, reason: null })
})
