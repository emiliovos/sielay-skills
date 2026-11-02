// The build hooks over a minimal `$` (clock, versioned state, log): what the
// poll carries, validation before sending, /clear, the cleanup after `done`
// and concurrent writes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  declareFromTool, noteSubagentStart, noteSubagentSpawn, noteSubagentStop, noteToolUse, noteTurnComplete, carryOnClear, pollBuild, pollBuildFields, afterPoll,
} from '../../plugins/sielay-link/mod/link-build-hooks.js'
import { DONE_HOLD_MS } from '../../plugins/sielay-link/mod/link-build-state.js'

const T0 = Date.parse('2026-10-20T23:00:00.000Z')
const min = { build_id: 'sielay-261020-builds-viewer', role: 'coordinator', stage: 4, status: 'running' }

function engine({ contend = 0 } = {}) {
  const values = new Map()
  const versions = new Map()
  const logs = []
  let clock = T0
  let losses = contend
  const $ = {
    clock: { now: async () => clock },
    state: {
      get: async ref => ({ value: structuredClone(values.get(ref.key)), version: versions.get(ref.key) ?? 0 }),
      set: async (ref, value, opts) => {
        const version = versions.get(ref.key) ?? 0
        if (losses > 0) {
          losses -= 1
          versions.set(ref.key, version + 1) // another hook wrote in between
          return { isSet: false, version: version + 1 }
        }
        if (opts?.ifVersion !== undefined && opts.ifVersion !== version) return { isSet: false, version }
        values.set(ref.key, structuredClone(value))
        versions.set(ref.key, version + 1)
        return { isSet: true, version: version + 1 }
      },
    },
    ui: { log: text => void logs.push(text) },
  }
  const rt = { buildCarry: null, buildError: null }
  return {
    $, rt, logs,
    advance: ms => void (clock += ms),
    raw: () => values.get('build'),
    put: v => void values.set('build', structuredClone(v)),
    wipe: () => void values.delete('build'),
  }
}

test('no build declared: the poll carries nothing and the hooks write nothing', async () => {
  const h = engine()
  await noteSubagentStart(h.$, h.rt, { agent_id: 'a1', agent_type: 'x' })
  await noteTurnComplete(h.$, h.rt, { usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' } })
  assert.equal(await pollBuild(h.$, h.rt), undefined)
  assert.equal(h.raw(), undefined)
})

test('a full session: declared fields, subagents paired by agentId, usage of main and subagents', async () => {
  const h = engine()
  assert.deepEqual(await declareFromTool(h.$, h.rt, { ...min, tool: 'mcp__sielay-link__link_build_stage', summary: 'Fase 1 y 5 en paralelo' }), {})
  await noteSubagentStart(h.$, h.rt, { agent_id: 'a1', agent_type: 'fullstack-developer' })
  await noteSubagentStart(h.$, h.rt, { agent_id: 'a2', agent_type: 'tester' })
  await noteSubagentSpawn(h.$, h.rt, { description: 'Fase 5: mod', subagentType: 'tester' }, { model: 'm', agentId: 'a2' })
  await noteSubagentSpawn(h.$, h.rt, { description: 'Fase 1: hub', subagentType: 'fullstack-developer' }, { model: 'm', agentId: 'a1' })
  await noteSubagentSpawn(h.$, h.rt, { description: 'denied' }, { deny: 'no' })
  await noteTurnComplete(h.$, h.rt, { agentId: 'a1', usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, model: 'sub' } })
  await noteTurnComplete(h.$, h.rt, { usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, model: 'main' } })
  await noteTurnComplete(h.$, h.rt, { agentId: 'a2' }) // interrupted: no usage, but its run ended

  const build = await pollBuild(h.$, h.rt)
  assert.equal(build.summary, 'Fase 1 y 5 en paralelo')
  assert.equal(build.tool, undefined)
  assert.deepEqual(build.subagents, [], 'both ended through their turn.complete')
  assert.equal(build.subagents_peak, 2)
  assert.deepEqual(build.usage, { input_tokens: 110, output_tokens: 11, cache_read_input_tokens: 22, cache_creation_input_tokens: 33, turns: 2, model: 'main' })
})

test('turn durations of main and subagents add up in usage.active_ms; a turn without durationMs adds nothing', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, min)
  await noteSubagentStart(h.$, h.rt, { agent_id: 'a1', agent_type: 'tester' })
  await noteTurnComplete(h.$, h.rt, { durationMs: 40_000, usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  await noteTurnComplete(h.$, h.rt, { agentId: 'a1', durationMs: 25_000 })
  await noteTurnComplete(h.$, h.rt, { usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  const build = await pollBuild(h.$, h.rt)
  assert.equal(build.usage.active_ms, 65_000)
  assert.equal(build.usage.turns, 2)
  assert.deepEqual(build.subagents, [], 'the subagent turn still ends its run')
})

test('/clear keeps usage.active_ms like the rest of usage', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, min)
  await noteTurnComplete(h.$, h.rt, { durationMs: 30_000 })
  await carryOnClear(h.$, h.rt, { reason: 'clear' })
  h.wipe()
  await noteTurnComplete(h.$, h.rt, { durationMs: 12_000 })
  assert.equal((await pollBuild(h.$, h.rt)).usage.active_ms, 42_000)
})

test('descriptions land on their own subagent while both are live', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, min)
  await noteSubagentStart(h.$, h.rt, { agent_id: 'a1', agent_type: 'fullstack-developer' })
  await noteSubagentStart(h.$, h.rt, { agent_id: 'a2', agent_type: 'tester' })
  await noteSubagentSpawn(h.$, h.rt, { description: 'Fase 1: hub' }, { agentId: 'a1' })
  await noteSubagentSpawn(h.$, h.rt, { description: 'Fase 5: mod' }, { agentId: 'a2' })
  await noteSubagentStop(h.$, h.rt, { agent_id: 'zz' })
  const subs = (await pollBuild(h.$, h.rt)).subagents
  assert.deepEqual(subs.map(s => [s.id, s.description]), [['a1', 'Fase 1: hub'], ['a2', 'Fase 5: mod']])
  await noteSubagentStop(h.$, h.rt, { agent_id: 'a1' })
  assert.deepEqual((await pollBuild(h.$, h.rt)).subagents.map(s => s.id), ['a2'])
})

test('an invalid build is validated before sending: not sent, and logged once by field', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, min)
  h.put({ ...h.raw(), declared: { ...h.raw().declared, stage: 9 } })
  assert.equal(await pollBuild(h.$, h.rt), undefined)
  assert.equal(await pollBuild(h.$, h.rt), undefined)
  assert.deepEqual(h.logs, ['sielay-link: build no enviado, campo inválido: stage'])
  assert.ok(!h.logs[0].includes('implementar'), 'the log names the field, never the content')
})

test('the tool refuses an invalid call and keeps the previous build', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, min)
  assert.deepEqual(await declareFromTool(h.$, h.rt, { ...min, status: 'paused' }), { error: 'status' })
  assert.equal((await pollBuild(h.$, h.rt)).status, 'running')
})

test('the tool refuses a bad estimate, or one that makes the merged build too big, and keeps the previous build', async () => {
  const h = engine()
  const est = { total_h: 7, phases: [{ name: 'Hub', h: 2 }] }
  await declareFromTool(h.$, h.rt, { ...min, estimate: est })
  assert.deepEqual(await declareFromTool(h.$, h.rt, { ...min, estimate: { total_h: 0.04 } }), { error: 'estimate.total_h' })
  // three-byte characters, so each part alone fits under BUILD_MAX_BYTES and both together do not
  const E = '€'
  const big = {
    status: 'blocked', title: E.repeat(120), plan: E.repeat(200), branch: E.repeat(120), phase: E.repeat(80), summary: E.repeat(600),
    links: Array.from({ length: 10 }, (_, i) => ({ label: E.repeat(80), href: `p/${i}/` + 'x'.repeat(290) })),
    flags: Array.from({ length: 20 }, (_, i) => `--f${i}`.padEnd(80, E)),
    waiting: { on: 'terminal', who: E.repeat(120), what: E.repeat(160), next: E.repeat(160) },
  }
  const wide = { total_h: 9, phases: Array.from({ length: 12 }, (_, i) => ({ name: `f${i}`.padEnd(80, 'x'), h: 1 })), assumption: 'a'.repeat(200) }
  for (const alone of [{ estimate: wide }, big]) {
    const other = engine()
    assert.deepEqual(await declareFromTool(other.$, other.rt, { ...min, ...alone }), {}, 'each part alone fits')
  }
  assert.deepEqual(await declareFromTool(h.$, h.rt, { ...min, ...big, estimate: wide }), { error: 'too_big' })
  const sent = await pollBuild(h.$, h.rt)
  assert.deepEqual(sent.estimate, { total_h: 7, phases: [{ name: 'Hub', h: 2 }], assumption: null, reason: null })
  assert.equal(sent.summary, undefined, 'nothing of the refused call was stored')
})

test('/clear keeps the build even if the host hands back an empty state', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, min)
  await carryOnClear(h.$, h.rt, { reason: 'clear' })
  h.wipe()
  assert.equal((await pollBuild(h.$, h.rt)).build_id, min.build_id)
  assert.equal(h.rt.buildCarry, null)
  await carryOnClear(h.$, h.rt, { reason: 'logout' })
  assert.equal(h.rt.buildCarry, null, 'only a clear carries it')
})

test('after a poll carried done the build is forgotten; a running report is kept', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, min)
  await afterPoll(h.$, h.rt, { build: await pollBuild(h.$, h.rt) })
  assert.ok(await pollBuild(h.$, h.rt))
  await declareFromTool(h.$, h.rt, { ...min, status: 'done', outcome: 'delivered' })
  await noteTurnComplete(h.$, h.rt, {})
  const sent = await pollBuild(h.$, h.rt)
  assert.equal(sent.outcome, 'delivered')
  await afterPoll(h.$, h.rt, { build: sent })
  assert.equal(h.raw(), null)
  assert.equal(await pollBuild(h.$, h.rt), undefined)
})

test('done waits for the end of its turn, and that turn counts in the report', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, min)
  await afterPoll(h.$, h.rt, { build: await pollBuild(h.$, h.rt) })
  await declareFromTool(h.$, h.rt, { ...min, status: 'done', outcome: 'delivered' })
  assert.equal(await pollBuild(h.$, h.rt), undefined, 'the turn that declared it is still running')
  await noteTurnComplete(h.$, h.rt, { agentId: 'a1', usage: { input_tokens: 1 } })
  assert.equal(await pollBuild(h.$, h.rt), undefined, 'a subagent ending is not the end of the turn')
  await noteTurnComplete(h.$, h.rt, { usage: { input_tokens: 10 } })
  const sent = await pollBuild(h.$, h.rt)
  assert.equal(sent.status, 'done')
  assert.equal(sent.usage.input_tokens, 11)
  assert.equal(sent.usage.turns, 2)
})

test('a held done goes out anyway when its turn never ends, so the build does not stay open', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, { ...min, status: 'done', outcome: 'delivered' })
  assert.equal(await pollBuild(h.$, h.rt), undefined)
  h.advance(DONE_HOLD_MS)
  assert.equal((await pollBuild(h.$, h.rt)).status, 'done')
})

test('a subagent with no signal for 30 min drops out; a tool call inside it keeps it', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, min)
  await noteSubagentStart(h.$, h.rt, { agent_id: 'a1', agent_type: 'x' })
  await noteSubagentStart(h.$, h.rt, { agent_id: 'a2', agent_type: 'y' })
  h.advance(20 * 60_000)
  await noteToolUse(h.$, h.rt, { agent_id: 'a2' })
  await noteToolUse(h.$, h.rt, {})
  h.advance(15 * 60_000)
  assert.deepEqual((await pollBuild(h.$, h.rt)).subagents.map(s => s.id), ['a2'])
})

test('a write that loses the version race is retried, not lost', async () => {
  const h = engine({ contend: 2 })
  assert.deepEqual(await declareFromTool(h.$, h.rt, min), {})
  assert.equal(h.raw().declared.build_id, min.build_id)
})

test('the poll carries the other open builds; with the current one gone it sends build null with them', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, min)
  await afterPoll(h.$, h.rt, { build: (await pollBuildFields(h.$, h.rt)).build })
  await declareFromTool(h.$, h.rt, { ...min, build_id: 'sielay-261025-otro' })
  const fields = await pollBuildFields(h.$, h.rt)
  assert.equal(fields.build.build_id, 'sielay-261025-otro')
  assert.deepEqual(fields.open_builds, [min.build_id])
  await declareFromTool(h.$, h.rt, { ...min, build_id: 'sielay-261025-otro', status: 'done', outcome: 'delivered' })
  await noteTurnComplete(h.$, h.rt, {})
  await afterPoll(h.$, h.rt, { build: (await pollBuildFields(h.$, h.rt)).build })
  assert.deepEqual(await pollBuildFields(h.$, h.rt), { build: null, open_builds: [min.build_id] })
})
