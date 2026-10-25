import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateBuild } from '../../plugins/sielay-link/mod/link-build-validate.js'
import { declareBuild } from '../../plugins/sielay-link/mod/link-build-state.js'

const NOW = Date.parse('2026-10-24T22:00:00Z')
const base = { build_id: 'sielay-x', role: 'coordinator', stage: 4, status: 'blocked' }

test('waiting: kept with blocked, texts capped, a safe href kept and a bad one dropped', () => {
  const { build } = validateBuild({ ...base, waiting: { on: 'terminal', who: 'emilio/vps-sielay/sielay-5', what: 'w'.repeat(200), next: 'al mergear', href: '/builds/x' } }, NOW)
  assert.deepEqual(build.waiting, { on: 'terminal', who: 'emilio/vps-sielay/sielay-5', what: 'w'.repeat(160), next: 'al mergear', href: '/builds/x' })
  for (const href of ['//evil.example', '/\\evil', 'javascript:alert(1)', 'http://x.y', '/']) {
    assert.equal(validateBuild({ ...base, waiting: { on: 'you', href } }, NOW).build.waiting.href, undefined, href)
  }
  assert.equal(validateBuild({ ...base, waiting: { on: 'pr', href: 'https://github.com/o/r/pull/1' } }, NOW).build.waiting.href, 'https://github.com/o/r/pull/1')
})

test('waiting: a bad on refuses the build; null clears; running and done leave it out', () => {
  assert.equal(validateBuild({ ...base, waiting: { on: 'nobody' } }, NOW).error, 'waiting.on')
  assert.equal(validateBuild({ ...base, waiting: 'x' }, NOW).error, 'waiting')
  assert.equal(validateBuild({ ...base, waiting: null }, NOW).build.waiting, null)
  assert.equal('waiting' in validateBuild({ ...base, status: 'running', waiting: { on: 'you' } }, NOW).build, false)
})

test('declareBuild drops waiting when the build goes back to running', () => {
  const s1 = declareBuild(null, { ...base, waiting: { on: 'you' } }, NOW)
  assert.deepEqual(s1.declared.waiting, { on: 'you' })
  const s2 = declareBuild(s1, { ...base, status: 'running' }, NOW)
  assert.equal('waiting' in s2.declared, false)
})

test('retro: only with done; lists cut to 5, proposals to 4, a bad kind becomes null', () => {
  const retro = { kind: 'weird', bien: Array.from({ length: 7 }, (_, i) => `b${i}`), mal: ['m'], batallo: [], propuestas: Array.from({ length: 6 }, (_, i) => ({ text: `p${i}`, applies_to: i ? 'repo' : 'nope' })) }
  assert.equal('retro' in validateBuild({ ...base, retro }, NOW).build, false)
  const { build } = validateBuild({ ...base, status: 'done', outcome: 'delivered', retro }, NOW)
  assert.equal(build.retro.kind, null)
  assert.equal(build.retro.bien.length, 5)
  assert.deepEqual(build.retro.propuestas, [{ text: 'p0' }, { text: 'p1', applies_to: 'repo' }, { text: 'p2', applies_to: 'repo' }, { text: 'p3', applies_to: 'repo' }])
  assert.equal(validateBuild({ ...base, status: 'done', retro: { bien: 'x' } }, NOW).error, 'retro.bien')
})

test('a full retro fits in the build', () => {
  const full = Array.from({ length: 5 }, () => 'á'.repeat(160))
  const retro = { kind: 'mixed', bien: full, mal: full, batallo: full, propuestas: Array.from({ length: 4 }, () => ({ text: 'á'.repeat(160), applies_to: 'plan' })) }
  assert.equal(validateBuild({ ...base, status: 'done', summary: 's'.repeat(600), retro }, NOW).error, undefined)
})
