import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateBuild } from '../../plugins/sielay-link/mod/link-build-validate.js'
import { declareBuild } from '../../plugins/sielay-link/mod/link-build-state.js'
import { BUILD_TOOL_SPEC } from '../../plugins/sielay-link/mod/link-build-tool.js'

const NOW = Date.parse('2026-10-25T19:00:00Z')
const base = { build_id: 'sielay-x', role: 'coordinator', stage: 5, status: 'running' }
const ok = extra => validateBuild({ ...base, ...extra }, NOW)

test('without the new fields the report is exactly what it was', () => {
  const { build } = ok({ delivery: { merge_pr: 'pending' } })
  assert.deepEqual(build, { ...base, delivery: { merge_pr: 'pending' } })
})

test('flow: the four values pass, an unknown one refuses the report', () => {
  for (const f of ['full', 'chico', 'fix', 'encargo']) assert.equal(ok({ flow: f, stage: 4 }).build.flow, f)
  assert.equal(ok({ flow: 'rapido' }).error, 'flow')
  assert.equal(ok({ flow: 3 }).error, 'flow')
  assert.equal('flow' in ok({ flow: null }).build, false)
})

test('stage_detail: a full one is kept, texts capped, a bad href dropped, items cut to 8', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ label: `l${i}`, value: 'v', href: i === 1 ? 'http://x.y' : 'plans/r.md' }))
  items[0] = { label: 'L'.repeat(100), value: 'V'.repeat(200), href: 'https://github.com/o/r/actions/runs/1' }
  const live = { label: 'gate corriendo', done: 2, total: 3, at: '2026-10-25T19:00:00Z' }
  const { build } = ok({ stage_detail: { stage: 5, items, live } })
  assert.equal(build.stage_detail.items.length, 8)
  assert.equal(build.stage_detail.items[0].label.length, 80)
  assert.equal(build.stage_detail.items[0].value.length, 160)
  assert.equal(build.stage_detail.items[0].href, 'https://github.com/o/r/actions/runs/1')
  assert.equal('href' in build.stage_detail.items[1], false)
  assert.deepEqual(build.stage_detail.live, live)
})

test('stage_detail: stage is required 1..7; bad items, live and counts refuse the report', () => {
  assert.equal(ok({ stage_detail: { items: [] } }).error, 'stage_detail.stage')
  assert.equal(ok({ stage_detail: { stage: 8 } }).error, 'stage_detail.stage')
  assert.equal(ok({ stage_detail: { stage: 1.5 } }).error, 'stage_detail.stage')
  assert.equal(ok({ stage_detail: 'x' }).error, 'stage_detail')
  assert.equal(ok({ stage_detail: { stage: 5, items: [{ value: 'v' }] } }).error, 'stage_detail.items.label')
  assert.equal(ok({ stage_detail: { stage: 5, items: 'x' } }).error, 'stage_detail.items')
  assert.equal(ok({ stage_detail: { stage: 5, live: { done: 1 } } }).error, 'stage_detail.live.label')
  assert.equal(ok({ stage_detail: { stage: 5, live: { label: 'x', done: -1 } } }).error, 'stage_detail.live.done')
  assert.equal(ok({ stage_detail: { stage: 5, live: { label: 'x', total: 1.5 } } }).error, 'stage_detail.live.total')
  assert.equal(ok({ stage_detail: { stage: 5, live: { label: 'x', at: '2026-10-25T19:10:00Z' } } }).error, 'stage_detail.live.at')
  assert.equal(ok({ stage_detail: { stage: 5, live: { label: 'x', at: '2026-10-25T19:04:00Z' } } }).build.stage_detail.live.at, '2026-10-25T19:04:00Z')
})

test('stage_detail: live null travels as null; secrets are scrubbed like summary', () => {
  assert.equal(ok({ stage_detail: { stage: 5, live: null } }).build.stage_detail.live, null)
  const { build } = ok({ stage_detail: { stage: 5, items: [{ label: 'token', value: 'ghp_' + 'a'.repeat(36) }] } })
  assert.ok(!JSON.stringify(build).includes('ghp_aaaa'))
})

test('stage_detail: the last one sent replaces the previous whole', () => {
  const s1 = declareBuild(null, { ...base, stage_detail: { stage: 5, items: [{ label: 'a' }], live: { label: 'x' } } }, NOW)
  const s2 = declareBuild(s1, { ...base, stage_detail: { stage: 5, items: [{ label: 'b' }] } }, NOW)
  assert.deepEqual(s2.declared.stage_detail, { stage: 5, items: [{ label: 'b' }] })
  assert.equal(declareBuild(s2, { ...base, summary: 's' }, NOW).declared.stage_detail.items[0].label, 'b')
})

test('delivery.merge_queue and deploy: valid kept, null position kept, a bad subfield drops only that object', () => {
  const merge_queue = { position: 2, total: 5, reason: 'r'.repeat(200), since: '2026-10-25T18:00:00Z' }
  const { build } = ok({ delivery: { merge_pr: 'pending', merge_queue, deploy: { state: 'publishing', at: '2026-10-25T18:30:00Z' } } })
  assert.deepEqual(build.delivery, { merge_pr: 'pending', merge_queue: { ...merge_queue, reason: 'r'.repeat(120) }, deploy: { state: 'publishing', at: '2026-10-25T18:30:00Z' } })
  assert.deepEqual(ok({ delivery: { merge_queue: { position: null, total: null } } }).build.delivery, { merge_queue: { position: null, total: null } })
  for (const bad of [{ position: 0 }, { total: 1.5 }, { since: 'ayer' }, { since: '2026-10-25T19:10:00Z' }, { reason: 4 }, 'x']) {
    assert.deepEqual(ok({ delivery: { merge_pr: 'merged', merge_queue: bad, deploy: { state: 'verified' } } }).build.delivery, { merge_pr: 'merged', deploy: { state: 'verified' } })
  }
  for (const bad of [{ state: 'boom' }, {}, { state: 'failed', at: 'x' }, 'x']) {
    assert.deepEqual(ok({ delivery: { deploy: bad, merge_queue: { position: 1 } } }).build.delivery, { merge_queue: { position: 1 } })
  }
  assert.equal(ok({ delivery: { merge_pr: 'nope', deploy: { state: 'verified' } } }).error, 'delivery.merge_pr')
})

test('the 16 KB cap holds a full stage_detail together with a full retro', () => {
  const items = Array.from({ length: 8 }, () => ({ label: 'L'.repeat(80), value: 'V'.repeat(160), href: 'https://example.com/' + 'p'.repeat(270) }))
  const five = Array.from({ length: 5 }, () => 'x'.repeat(160))
  const retro = { kind: 'mixed', bien: five, mal: five, batallo: five, entregado: five, pendientes: five, propuestas: Array.from({ length: 4 }, () => ({ text: 'p'.repeat(160), applies_to: 'repo' })) }
  const { build, error } = validateBuild({ ...base, status: 'done', outcome: 'delivered', summary: 's'.repeat(600), retro, stage_detail: { stage: 5, items, live: { label: 'l'.repeat(120), done: 1, total: 2 } } }, NOW)
  assert.equal(error, undefined)
  assert.ok(new TextEncoder().encode(JSON.stringify(build)).length <= 16384)
})

test('the tool schema declares flow, stage_detail and the delivery blocks', () => {
  const p = BUILD_TOOL_SPEC.inputSchema.properties
  assert.deepEqual(p.flow.enum, ['full', 'chico', 'fix', 'encargo'])
  assert.deepEqual(p.stage_detail.required, ['stage'])
  assert.ok(p.delivery.properties.merge_queue && p.delivery.properties.deploy)
})
