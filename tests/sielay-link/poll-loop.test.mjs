import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPollLoop, WAIT_S, PAUSE_MS, OFF_RECHECK_MS, MIN_EMPTY_POLL_MS } from '../../plugins/sielay-link/mod/link-poll-loop.js'
import { createInboundHandler } from '../../plugins/sielay-link/mod/link-inbound-handler.js'
import { HubError } from '../../plugins/sielay-link/mod/link-hub-client.js'

const msg = (id, extra = {}) => ({
  id, conversation_id: 'c1', seq: 1, turn: 1, max_turns: 10,
  from: { address: 'ana/laptop/api', mode: 'bypassPermissions' }, body: `body ${id}`, run: 1, gate: 'auto', ...extra,
})

function memStore() {
  const m = new Map()
  return { m, get: async k => m.get(k), set: async (k, v) => void m.set(k, structuredClone(v)) }
}

/** Builds a loop whose timer queue the test drives one round at a time. */
function harness({ answers, mode = { mode: 'bypassPermissions', fresh: true }, off = false, instanceIds } = {}) {
  const timers = []
  const polls = []
  const injected = []
  const statuses = []
  let strip = []
  let round = 0
  const client = {
    poll: async body => {
      polls.push(structuredClone(body))
      const a = answers[Math.min(polls.length - 1, answers.length - 1)]
      if (a instanceof Error) throw a
      return a
    },
  }
  const state = { off, mode, client }
  const handler = createInboundHandler({
    store: memStore(),
    adapter: { inject: async text => void injected.push(text) },
    readMode: async () => state.mode,
    onStrip: async items => void (strip = items),
  })
  const loop = createPollLoop({
    schedule: (ms, fn) => timers.push({ ms, fn }),
    getClient: () => state.client,
    buildSession: async () => ({ name: 'api', instance_id: instanceIds ? instanceIds[round++] ?? 'last' : 'inst-1' }),
    handler,
    isOff: async () => state.off,
    onStatus: s => void statuses.push(s),
  })
  async function step() {
    const t = timers.shift()
    assert.ok(t, 'a timer is scheduled')
    t.fn()
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))
    return t.ms
  }
  return { loop, step, timers, polls, injected, statuses, state, getStrip: () => strip }
}

const ok = (messages = [], extra = {}) => ({ session: { id: 's1' }, messages, strip: [], poll_after_ms: 0, ...extra })

test('a fresh-bypass run=1 message is injected once and acked inside the next poll', async () => {
  const h = harness({ answers: [ok([msg('m1')]), ok([msg('m1')]), ok()] })
  h.loop.start()
  await h.step()
  assert.equal(h.polls[0].wait_s, WAIT_S)
  assert.equal(h.polls[0].ack, undefined)
  assert.equal(h.injected.length, 1)
  assert.match(h.injected[0], /^\[sielay-link de=ana\/laptop\/api conv=c1 turno=1\/10 /)
  await h.step()
  assert.deepEqual(h.polls[1].ack, [{ id: 'm1', outcome: 'injected' }])
  assert.equal(h.injected.length, 1, 'the redelivered id is deduped, not injected again')
  await h.step()
  assert.deepEqual(h.polls[2].ack, [{ id: 'm1', outcome: 'injected' }], 'the re-ack keeps the first outcome')
})

test('the mode is read at injection time: stale bypass goes to the strip with ack shown', async () => {
  const h = harness({ answers: [ok([msg('m2')]), ok()], mode: { mode: 'bypassPermissions', fresh: false } })
  h.loop.start()
  await h.step()
  assert.equal(h.injected.length, 0)
  assert.deepEqual(h.getStrip().map(d => d.id), ['m2'])
  await h.step()
  assert.deepEqual(h.polls[1].ack, [{ id: 'm2', outcome: 'shown' }])
})

test('the loop survives an exception and backs off', async () => {
  const h = harness({ answers: [new Error('boom'), new Error('boom'), ok()] })
  h.loop.start()
  assert.equal(await h.step(), 0)
  assert.equal(h.timers[0].ms, 1000)
  await h.step()
  assert.equal(h.timers[0].ms, 2000)
  await h.step()
  assert.equal(h.timers[0].ms, MIN_EMPTY_POLL_MS, 'success resets the backoff (an empty fast answer waits the floor)')
  assert.equal(h.statuses.at(-1), 'online')
})

test('acks survive a failed poll and ride the next one', async () => {
  const h = harness({ answers: [ok([msg('m3')]), new Error('down'), ok()] })
  h.loop.start()
  await h.step()
  await h.step()
  await h.step()
  assert.deepEqual(h.polls[2].ack, [{ id: 'm3', outcome: 'injected' }])
})

test('503 pauses, 429 honours retry-after, 401 stops until start()', async () => {
  const paused = harness({ answers: [new HubError('paused', 'x', { status: 503 })] })
  paused.loop.start()
  await paused.step()
  assert.equal(paused.timers[0].ms, PAUSE_MS)

  const limited = harness({ answers: [new HubError('rate_limited', 'x', { status: 429, retryAfterMs: 7000 })] })
  limited.loop.start()
  await limited.step()
  assert.equal(limited.timers[0].ms, 7000)

  const revoked = harness({ answers: [new HubError('unauthorized', 'x', { status: 401 }), ok()] })
  revoked.loop.start()
  await revoked.step()
  assert.equal(revoked.timers.length, 0, 'nothing rescheduled after 401')
  assert.equal(revoked.loop.isStopped, true)
  assert.equal(revoked.statuses.at(-1), 'unauthorized')
  revoked.loop.start()
  await revoked.step()
  assert.equal(revoked.polls.length, 2)
})

test('SIELAY_LINK_OFF / /link off: no poll, rechecks later', async () => {
  const h = harness({ answers: [ok()], off: true })
  h.loop.start()
  await h.step()
  assert.equal(h.polls.length, 0)
  assert.equal(h.timers[0].ms, OFF_RECHECK_MS)
  assert.equal(h.statuses.at(-1), 'off')
  h.state.off = false
  await h.step()
  assert.equal(h.polls.length, 1)
})

test('not paired: no poll, status unpaired', async () => {
  const h = harness({ answers: [ok()] })
  h.state.client = null
  h.loop.start()
  await h.step()
  assert.equal(h.polls.length, 0)
  assert.equal(h.statuses.at(-1), 'unpaired')
})

test('instance_id is re-read every round; dedupe is per instance_id', async () => {
  const h = harness({ answers: [ok([msg('m4')]), ok([msg('m4')])], instanceIds: ['a', 'b'] })
  h.loop.start()
  await h.step()
  await h.step()
  assert.deepEqual(h.polls.map(p => p.session.instance_id), ['a', 'b'])
  assert.equal(h.injected.length, 2, 'a new instance (after /clear) is a new dedupe scope')
})

test('a stale timer from before a restart does nothing', async () => {
  const h = harness({ answers: [ok()] })
  h.loop.start()
  const old = h.timers.shift()
  h.loop.start()
  old.fn()
  await new Promise(r => setImmediate(r))
  assert.equal(h.polls.length, 0)
  await h.step()
  assert.equal(h.polls.length, 1)
})

test('poll_after_ms is honoured and capped at 60 s', async () => {
  const h = harness({ answers: [ok([], { poll_after_ms: 999_999 })] })
  h.loop.start()
  await h.step()
  assert.equal(h.timers[0].ms, 60_000)
})

test('start() while a tick is in flight never kills the loop (single loop, no silent death)', async () => {
  const timers = []
  let release
  let polls = 0
  const loop = createPollLoop({
    schedule: (ms, fn) => timers.push({ ms, fn }),
    getClient: () => ({ poll: async () => (polls++, { messages: [], poll_after_ms: 0 }) }),
    buildSession: async () => ({ instance_id: 'i' }),
    handler: { handlePoll: async () => [] },
    isOff: () => new Promise(r => (release = r)),
    now: () => 0,
  })
  loop.start()
  timers.shift().fn() // generation 1 is running, waiting on isOff
  loop.start()
  timers.shift().fn() // generation 2 finds a tick running
  release(false)
  await new Promise(r => setTimeout(r, 20))
  assert.equal(timers.length, 1, 'exactly one timer queued: the loop is alive and single')
})

test('an empty answer that came back fast waits at least the floor before the next poll', async () => {
  const timers = []
  let t = 0
  const loop = createPollLoop({
    schedule: (ms, fn) => timers.push({ ms, fn }),
    getClient: () => ({ poll: async () => ((t += 50), { messages: [], strip: [], poll_after_ms: 0 }) }),
    buildSession: async () => ({ instance_id: 'i' }),
    handler: { handlePoll: async () => [] },
    isOff: async () => false,
    now: () => t,
  })
  loop.start()
  timers.shift().fn()
  await new Promise(r => setTimeout(r, 10))
  assert.equal(timers[0].ms, MIN_EMPTY_POLL_MS)
})
