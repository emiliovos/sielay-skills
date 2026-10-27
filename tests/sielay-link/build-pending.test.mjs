// Several link_build_stage calls on different builds between two polls: the
// hub takes one build per poll, so the displaced ones queue and go out one
// per poll, oldest first, before the current one. Nothing is lost, a queued
// done still closes its build, and the current one rides as open meanwhile.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { declareFromTool, pollBuildFields, afterPoll } from '../../plugins/sielay-link/mod/link-build-hooks.js'
import { declareBuild } from '../../plugins/sielay-link/mod/link-build-state.js'
import { markSent } from '../../plugins/sielay-link/mod/link-build-pending.js'

const T0 = Date.parse('2026-10-27T01:11:00.000Z')
const decl = (id, extra = {}) => ({ build_id: id, role: 'coordinator', stage: 7, status: 'running', ...extra })

function engine() {
  const values = new Map()
  let version = 0
  let clock = T0
  const $ = {
    clock: { now: async () => clock },
    state: {
      get: async () => ({ value: structuredClone(values.get('build')), version }),
      set: async (_ref, value, opts) => {
        if (opts?.ifVersion !== undefined && opts.ifVersion !== version) return { isSet: false, version }
        values.set('build', structuredClone(value))
        version += 1
        return { isSet: true, version }
      },
    },
    ui: { log: () => {} },
  }
  const rt = { buildCarry: null, buildError: null }
  const poll = async () => {
    const fields = await pollBuildFields($, rt)
    await afterPoll($, rt, { build: fields.build })
    clock += 25_000
    return fields
  }
  return { $, rt, poll, raw: () => values.get('build'), advance: ms => void (clock += ms) }
}

test('a coordinator closing two builds and moving to a third between polls loses none of them', async () => {
  const h = engine()
  for (const id of ['tablero360-a-mensajes', 'tablero360-b-barra']) {
    await declareFromTool(h.$, h.rt, decl(id))
    await h.poll()
  }
  await declareFromTool(h.$, h.rt, decl('sielay-c-rumbo'))
  await h.poll()
  // the burst: two corrections closing a and b, then the build it goes on with
  await declareFromTool(h.$, h.rt, decl('tablero360-a-mensajes', { status: 'done', outcome: 'delivered', summary: 'Entregado a' }))
  await declareFromTool(h.$, h.rt, decl('tablero360-b-barra', { status: 'done', outcome: 'delivered', summary: 'Entregado b' }))
  await declareFromTool(h.$, h.rt, decl('tablero360-lotes', { summary: 'Ya publicado' }))

  const first = await h.poll()
  assert.equal(first.build.build_id, 'tablero360-a-mensajes')
  assert.equal(first.build.status, 'done')
  assert.equal(first.build.summary, 'Entregado a')
  assert.ok(first.open_builds.includes('tablero360-lotes'), 'the current build stays open while the queue drains')
  assert.ok(first.open_builds.includes('sielay-c-rumbo'))
  assert.ok(first.open_builds.includes('tablero360-b-barra'), 'the rest of the queue rides too, so the hub does not take it as left')

  const second = await h.poll()
  assert.equal(second.build.build_id, 'tablero360-b-barra')
  assert.equal(second.build.summary, 'Entregado b')
  assert.equal(second.open_builds.includes('tablero360-a-mensajes'), false, 'a done build is not kept open')

  const third = await h.poll()
  assert.equal(third.build.build_id, 'tablero360-lotes')
  assert.equal(third.build.summary, 'Ya publicado')
  assert.deepEqual(third.open_builds, ['sielay-c-rumbo'])
  assert.equal(h.raw().pending, undefined)
  assert.equal(h.raw().unsent, undefined)
})

test('a build already carried by a poll does not queue when another takes over', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, decl('repo-a-one'))
  await h.poll()
  await declareFromTool(h.$, h.rt, decl('repo-b-two'))
  const next = await h.poll()
  assert.equal(next.build.build_id, 'repo-b-two')
  assert.deepEqual(next.open_builds, ['repo-a-one'])
})

test('re-declaring a queued build merges into what it had, keeping its start', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, decl('repo-a-one', { title: 'Uno', stage: 5 }))
  h.advance(1000)
  await declareFromTool(h.$, h.rt, decl('repo-b-two'))
  const queuedStart = h.raw().pending[0].started_at
  await declareFromTool(h.$, h.rt, decl('repo-a-one', { stage: 6 }))
  assert.equal(h.raw().pending[0].declared.build_id, 'repo-b-two', 'a left the queue, b joined it')
  assert.equal(h.raw().declared.title, 'Uno')
  assert.equal(h.raw().started_at, queuedStart)
  const sent = await h.poll()
  assert.equal(sent.build.build_id, 'repo-b-two')
  assert.equal((await h.poll()).build.stage, 6)
})

test('a done and a new build declared while a poll carries the old report still go out', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, decl('repo-a-one'))
  const inFlight = await pollBuildFields(h.$, h.rt)
  assert.equal(inFlight.build.status, 'running')
  h.advance(1000)
  await declareFromTool(h.$, h.rt, decl('repo-a-one', { status: 'done', outcome: 'delivered' }))
  h.advance(1000)
  await declareFromTool(h.$, h.rt, decl('repo-b-two'))
  await afterPoll(h.$, h.rt, { build: inFlight.build })
  const next = await h.poll()
  assert.equal(next.build.build_id, 'repo-a-one')
  assert.equal(next.build.status, 'done')
  assert.equal((await h.poll()).build.build_id, 'repo-b-two')
})

test('past the cap the oldest queued build goes, a done last', async () => {
  const h = engine()
  await declareFromTool(h.$, h.rt, decl('repo-done-00', { status: 'done', outcome: 'delivered' }))
  for (let i = 1; i <= 14; i++) await declareFromTool(h.$, h.rt, decl(`repo-build-${String(i).padStart(2, '0')}`))
  const ids = h.raw().pending.map(p => p.declared.build_id)
  assert.equal(ids.length, 12)
  assert.equal(ids[0], 'repo-done-00')
  assert.equal(ids.includes('repo-build-01'), false)
})

test('a call landing while a poll is out keeps the current build unsent', () => {
  const a = declareBuild(null, decl('repo-a-one'), T0)
  const later = declareBuild(a, decl('repo-a-one', { summary: 'nuevo' }), T0 + 10)
  assert.equal(markSent(later, { build_id: 'repo-a-one' }, a.touched_at).unsent, true)
  assert.equal(markSent(later, { build_id: 'repo-a-one' }, later.touched_at).unsent, undefined)
})
