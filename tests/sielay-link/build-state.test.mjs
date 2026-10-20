// The build state's pure transitions: declare/merge, live subagents (pairing by
// agentId, stop, expiry, peak), usage and the report sent in the poll.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  declareBuild, subagentUp, subagentSeen, subagentDown, addUsage, forgetIfDone, buildReport, pruneExpired, SUBAGENT_EXPIRY_MS,
} from '../../plugins/sielay-link/mod/link-build-state.js'

const T0 = Date.parse('2026-10-20T23:00:00.000Z')
const min = { build_id: 'sielay-261020-builds-viewer', role: 'coordinator', stage: 4, status: 'running' }
const usage = (n, model = 'claude-opus') => ({ input_tokens: n, output_tokens: n * 2, cache_read_input_tokens: n * 3, cache_creation_input_tokens: n * 4, model })

test('declare: the mod stamps started_at and stage_since; usage starts unknown (null), not zero', () => {
  const s = declareBuild(null, { ...min, tool: 'mcp__x', subagents: [{ id: 'fake' }], usage: { input_tokens: 9 }, started_at: '2020-01-01T00:00:00Z' }, T0)
  assert.deepEqual(s.declared, { ...min, stage_since: '2026-10-20T23:00:00.000Z' })
  assert.equal(s.started_at, '2026-10-20T23:00:00.000Z')
  assert.equal(s.usage, null)
  assert.deepEqual(s.subagents, {})
  assert.equal(buildReport(s, T0).build.usage, null)
})

test('declare: same build_id merges (delivery one level deep); stage_since moves only with the stage', () => {
  let s = declareBuild(null, { ...min, delivery: { merge_pr: 'pending', deploy_pending: true }, summary: 'a' }, T0)
  s = declareBuild(s, { build_id: min.build_id, delivery: { merge_pr: 'merged' } }, T0 + 1000)
  assert.deepEqual(s.declared.delivery, { merge_pr: 'merged', deploy_pending: true })
  assert.equal(s.declared.summary, 'a')
  assert.equal(s.declared.stage_since, new Date(T0).toISOString())
  s = declareBuild(s, { build_id: min.build_id, stage: 5 }, T0 + 2000)
  assert.equal(s.declared.stage_since, new Date(T0 + 2000).toISOString())
  assert.equal(s.started_at, new Date(T0).toISOString())
})

test('declare: a new build_id starts over (usage, peak) but keeps the subagents still running', () => {
  let s = declareBuild(null, min, T0)
  s = subagentUp(s, { id: 'a1', type: 'tester' }, T0)
  s = addUsage(s, usage(10), true)
  s = declareBuild(s, { ...min, build_id: 'sielay-261020-builds-viewer-r2' }, T0 + 5)
  assert.equal(s.usage, null)
  assert.deepEqual(Object.keys(s.subagents), ['a1'])
  assert.equal(s.peak, 1)
})

test('nothing is tracked without a declared build', () => {
  assert.equal(subagentUp(null, { id: 'a1', type: 'x' }, T0), null)
  assert.equal(addUsage(null, usage(5), true), null)
  assert.equal(subagentDown(null, 'a1'), null)
})

test('subagents: type from SubagentStart and description from agent.spawn are paired by agentId, in either order', () => {
  let s = declareBuild(null, min, T0)
  s = subagentUp(s, { id: 'a1', type: 'fullstack-developer' }, T0)
  s = subagentUp(s, { id: 'a2', type: 'tester' }, T0 + 1)
  s = subagentUp(s, { id: 'a2', description: 'Pruebas de la fase 2' }, T0 + 2)
  s = subagentUp(s, { id: 'a3', description: 'Fase 3' }, T0 + 3)
  s = subagentUp(s, { id: 'a3', type: 'code-reviewer' }, T0 + 4)
  s = subagentUp(s, { id: 'a1', description: 'Fase 1: hub' }, T0 + 5)
  const subs = buildReport(s, T0 + 10).build.subagents
  assert.deepEqual(subs.map(x => [x.id, x.type, x.description]), [
    ['a1', 'fullstack-developer', 'Fase 1: hub'],
    ['a2', 'tester', 'Pruebas de la fase 2'],
    ['a3', 'code-reviewer', 'Fase 3'],
  ])
  assert.equal(subs[0].started_at, new Date(T0).toISOString(), 'the second signal keeps the first start')
})

test('subagents: stop removes; the peak stays; expiry at 30 min without signal; a tool call is a signal', () => {
  let s = declareBuild(null, min, T0)
  s = subagentUp(s, { id: 'a1', type: 'x' }, T0)
  s = subagentUp(s, { id: 'a2', type: 'y' }, T0)
  s = subagentDown(s, 'a1')
  assert.equal(s.peak, 2)
  assert.deepEqual(buildReport(s, T0).build.subagents.map(x => x.id), ['a2'])
  assert.equal(buildReport(s, T0).build.subagents_peak, 2)
  assert.equal(subagentDown(s, 'nope'), s, 'an unknown id changes nothing')

  const seen = subagentSeen(s, 'a2', T0 + 20 * 60_000)
  assert.deepEqual(buildReport(seen, T0 + 40 * 60_000).build.subagents.map(x => x.id), ['a2'], 'seen at 20 min: alive at 40')
  assert.deepEqual(buildReport(s, T0 + SUBAGENT_EXPIRY_MS + 1).build.subagents, [], 'no signal for 30 min: gone')
  assert.deepEqual(pruneExpired(s, T0 + SUBAGENT_EXPIRY_MS + 1).subagents, {})
  assert.equal(subagentSeen(s, 'a2', T0 + 1000), s, 'a refresh within a minute writes nothing')
  assert.equal(subagentSeen(s, 'ghost', T0 + 120_000), s, 'a tool call never adds a subagent')
})

test('subagents: the peak counts live ones only (an expired one does not inflate it)', () => {
  let s = declareBuild(null, min, T0)
  s = subagentUp(s, { id: 'a1', type: 'x' }, T0)
  s = subagentUp(s, { id: 'a2', type: 'x' }, T0 + SUBAGENT_EXPIRY_MS + 1)
  assert.equal(s.peak, 1)
})

test('usage: sums every turn of the session (main and subagents); a turn without usage adds nothing', () => {
  let s = declareBuild(null, min, T0)
  s = addUsage(s, usage(10, 'opus-main'), true)
  s = addUsage(s, usage(5, 'sonnet-sub'), false)
  s = addUsage(s, undefined, true)
  s = addUsage(s, null, false)
  assert.deepEqual(buildReport(s, T0).build.usage, {
    input_tokens: 15, output_tokens: 30, cache_read_input_tokens: 45, cache_creation_input_tokens: 60, turns: 2, model: 'opus-main',
  })
})

test('usage: no model is made up when the main loop never reported one', () => {
  let s = declareBuild(null, min, T0)
  s = addUsage(s, usage(1, 'sub-model'), false)
  assert.equal('model' in buildReport(s, T0).build.usage, false)
})

test('report: a too-big build sheds descriptions, then the oldest subagents, and still goes', () => {
  let s = declareBuild(null, { ...min, summary: 's'.repeat(600), links: Array.from({ length: 10 }, (_, i) => ({ label: 'l'.repeat(80), href: `p/${i}/` + 'x'.repeat(200) })) }, T0)
  for (let i = 0; i < 50; i++) s = subagentUp(s, { id: `agent-${String(i).padStart(2, '0')}`, type: 't'.repeat(70), description: 'd'.repeat(160) }, T0 + i)
  const r = buildReport(s, T0 + 100)
  assert.equal(r.error, undefined)
  assert.ok(r.build.subagents.length < 50 && r.build.subagents.length > 0)
  assert.ok(r.build.subagents.every(x => x.description === undefined))
  assert.equal(r.build.subagents.at(-1).id, 'agent-49', 'the newest are kept')
  assert.equal(r.build.subagents_peak, 50)
})

test('report: an invalid declared field refuses the build, naming it', () => {
  const s = declareBuild(null, { ...min, stage: 9 }, T0)
  assert.deepEqual(buildReport(s, T0), { build: undefined, error: 'stage' })
})

test('forgetIfDone: only the same build, still done, is forgotten after its done went out', () => {
  const done = declareBuild(null, { ...min, status: 'done' }, T0)
  assert.equal(forgetIfDone(done, { build_id: min.build_id, status: 'done' }), null)
  assert.equal(forgetIfDone(done, { build_id: min.build_id, status: 'running' }), done)
  assert.equal(forgetIfDone(done, undefined), done)
  const next = declareBuild(done, { ...min, build_id: 'sielay-261020-builds-viewer-r2' }, T0)
  assert.equal(forgetIfDone(next, { build_id: min.build_id, status: 'done' }), next, 'a new run declared meanwhile survives')
})
