import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createThreads, recordInbound, recordOutbound, endingOf, hhmm, sentAtMs, threadGlyph, markFrom, seqOf,
  THREAD_ACTIVE_MS, MAX_MARKS,
} from '../../plugins/sielay-link/mod/link-threads.js'

const MIN = 60_000
const SELF = 'emilio/vps-sielay/sielay-6'

/** A registry on an in-memory state with a clock the test moves. */
function rig(start = Date.UTC(2026, 9, 26, 19, 40)) {
  const h = { reg: undefined, now: start, slow: false }
  const threads = createThreads({
    get: async () => {
      const v = structuredClone(h.reg)
      if (h.slow) await new Promise(r => setTimeout(r, 3))
      return v
    },
    set: async v => void (h.reg = structuredClone(v)),
    now: () => h.now,
  })
  return { h, threads }
}
const delivery = (conv, seq, extra = {}) => ({
  id: `m-${conv}-${seq}`, conversation_id: conv, seq, turn: seq, max_turns: 40,
  from: { address: 'emilio/vps-sielay/operacion', project: 'sielay' }, body: 'hola', sent_at: '2026-10-26T19:42:00.000Z', ...extra,
})

test('numbers: the lowest free one among the open threads, and a closed thread gives its number back', async () => {
  const { threads } = rig()
  const a = await recordInbound(threads, delivery('a', 1))
  const b = await recordInbound(threads, delivery('b', 1))
  const c = await recordInbound(threads, delivery('c', 1))
  assert.deepEqual([a.n, b.n, c.n], [1, 2, 3])
  await recordInbound(threads, delivery('a', 2, { conversation: { status: 'closed', closed_reason: 'end', closed_by: 'emilio/vps-sielay/operacion' } }))
  const d = await recordInbound(threads, delivery('d', 1))
  assert.equal(d.n, 1)
  assert.deepEqual([threadGlyph(1), threadGlyph(10), threadGlyph(20), threadGlyph(21), threadGlyph(0)], ['①', '⑩', '⑳', '', ''])
})

test('after 20 open threads the oldest one gives its number up', async () => {
  const { h, threads } = rig()
  for (let i = 1; i <= 20; i++) {
    h.now += 1_000
    assert.equal((await recordInbound(threads, delivery(`t${i}`, 1))).n, i)
  }
  h.now += 1_000
  const extra = await recordInbound(threads, delivery('t21', 1))
  assert.equal(extra.n, 1, 't1 has the oldest turn')
})

test('crossed is fixed when the event happens: the first thread stays unnumbered, the second is numbered, and it sticks', async () => {
  const { h, threads } = rig()
  const first = await recordInbound(threads, delivery('a', 1))
  assert.deepEqual([first.crossed, first.first], [false, true])
  h.now += 2 * MIN
  const second = await recordInbound(threads, delivery('b', 1))
  assert.deepEqual([second.crossed, second.first], [true, true])
  h.now += MIN
  const out = await recordOutbound(threads, { toolUseId: 'tu1', conv: 'a', to: 'emilio/vps-sielay/operacion', turn: 2 }, SELF)
  assert.deepEqual([out.crossed, out.first, out.n, out.out], [true, false, 1, true])
  assert.equal(markFrom(await threads.read(), 'a#1').crossed, false, 'an earlier mark never changes')
  // b closes; a keeps its number from then on
  await recordInbound(threads, delivery('b', 2, { conversation: { status: 'closed', closed_reason: 'end', closed_by: 'emilio/vps-sielay/operacion' } }))
  h.now += MIN
  assert.equal((await recordInbound(threads, delivery('a', 3))).crossed, true)
})

test('a lone thread is never crossed, and a thread idle for 30 minutes no longer counts as open', async () => {
  const { h, threads } = rig()
  await recordInbound(threads, delivery('a', 1))
  h.now += THREAD_ACTIVE_MS + 1
  const later = await recordInbound(threads, delivery('b', 1, { sent_at: new Date(h.now).toISOString() }))
  assert.deepEqual([later.crossed, later.n], [false, 1], 'a is idle: b takes its number and is not crossed')
  h.now += 5 * MIN
  const back = await recordInbound(threads, delivery('a', 2, { sent_at: new Date(h.now).toISOString() }))
  assert.deepEqual([back.n, back.first, back.crossed], [2, true, true], 'a came back while b holds ①: new number and its header again')
})

test('turns = the highest turn seen; a redelivery (run=1) keeps its mark and counts nothing twice', async () => {
  const { h, threads } = rig()
  const m3 = await recordInbound(threads, delivery('a', 3, { run: 0 }))
  h.now += MIN
  const again = await recordInbound(threads, delivery('a', 3, { id: 'm-other-id', run: 1 }))
  assert.deepEqual(again, m3)
  await recordInbound(threads, delivery('a', 1))
  assert.equal((await threads.read()).threads.a.turns, 3)
  assert.equal(Object.keys((await threads.read()).marks).length, 2)
})

test('the closure is marked once per thread, on the highest turn of the poll', async () => {
  const { threads } = rig()
  const closed = { status: 'closed', closed_reason: 'end', closed_by: 'emilio/vps-sielay/operacion' }
  const low = await recordInbound(threads, delivery('a', 1, { conversation: closed }), { last: false })
  const high = await recordInbound(threads, delivery('a', 3, { conversation: closed }), { last: true })
  assert.equal(low.closed, undefined)
  assert.deepEqual(high.closed, { by: 'emilio/vps-sielay/operacion', reason: 'end', at: high.closed.at, hhmm: high.hhmm, turns: 3 })
  const after = await recordInbound(threads, delivery('a', 4, { conversation: closed }))
  assert.equal(after.closed, undefined, 'a second card of a closed thread marks no second closure')
})

test('the hub status maps to a closure: capped is «cap», archived is closed, open or absent is nothing', () => {
  assert.deepEqual(endingOf({ status: 'capped', closed_reason: null, closed_by: null }), { by: null, reason: 'cap' })
  assert.deepEqual(endingOf({ status: 'archived', closed_reason: 'idle', closed_by: null }), { by: null, reason: 'idle' })
  assert.deepEqual(endingOf({ status: 'closed', closed_reason: 'admin', closed_by: 'ana/x/y' }), { by: 'ana/x/y', reason: 'admin' })
  assert.deepEqual(endingOf({ status: 'closed', closed_reason: 'end', closed_by: 'no es una dirección' }), { by: null, reason: 'end' })
  assert.equal(endingOf({ status: 'open', closed_reason: null, closed_by: null }), null)
  assert.equal(endingOf(undefined), null)
  assert.equal(endingOf('closed'), null)
})

test('what this session sends: end closes by itself, a 409 is a refusal with the hub reason, the gate becomes the state', async () => {
  const { threads } = rig()
  const end = await recordOutbound(threads, { toolUseId: 'tu-end', conv: 'a', to: 'emilio/vps-sielay/operacion', turn: 4, end: true }, SELF)
  assert.equal(end.closed.by, SELF)
  assert.equal(end.closed.turns, 4)
  const refused = await recordOutbound(threads, { toolUseId: 'tu-409', conv: 'b', to: 'emilio/pve2/sielay-3', closed: { by: undefined, reason: 'idle' } }, SELF)
  assert.deepEqual([refused.refused, refused.closed.reason, refused.closed.turns], [true, 'idle', 0])
  const held = await recordOutbound(threads, { toolUseId: 'tu-held', conv: 'c', to: 'emilio/pve2/sielay-3', gate: 'held', turn: 1 }, SELF)
  assert.equal(held.state, 'held')
  assert.equal((await recordOutbound(threads, { toolUseId: 'tu-auto', conv: 'd', to: 'emilio/pve2/sielay-3', gate: 'auto' }, SELF)).state, undefined)
  assert.equal(await recordOutbound(threads, { toolUseId: undefined, conv: 'e', to: 'a/b/c' }, SELF), null, 'no tool_use_id, no mark')
})

test('writes run one after another: parallel events never share a number', async () => {
  const { h, threads } = rig()
  h.slow = true
  const marks = await Promise.all(['a', 'b', 'c', 'd'].map(c => recordInbound(threads, delivery(c, 1))))
  assert.deepEqual(marks.map(m => m.n).sort(), [1, 2, 3, 4])
  assert.equal(Object.keys((await threads.read()).marks).length, 4)
})

test('only the last MAX_MARKS marks are kept', async () => {
  const { threads } = rig()
  for (let i = 1; i <= MAX_MARKS + 5; i++) await recordInbound(threads, delivery('a', i))
  const { marks } = await threads.read()
  assert.equal(Object.keys(marks).length, MAX_MARKS)
  assert.equal(markFrom({ marks }, 'a#1'), undefined)
  assert.ok(markFrom({ marks }, `a#${MAX_MARKS + 5}`))
})

test('the clock time is HH:MM of the process zone; a zoneless hub time is UTC; a delivery without sent_at uses the clock', async () => {
  assert.equal(hhmm(new Date(2026, 9, 26, 9, 5).getTime()), '09:05')
  assert.equal(hhmm(new Date(2026, 9, 26, 23, 59).getTime()), '23:59')
  assert.equal(hhmm(NaN), '')
  assert.equal(sentAtMs('2026-10-26 15:04:05'), Date.UTC(2026, 9, 26, 15, 4, 5))
  assert.equal(sentAtMs('2026-10-26T15:04:05.000Z'), Date.UTC(2026, 9, 26, 15, 4, 5))
  assert.equal(sentAtMs('mañana'), null)
  assert.equal(sentAtMs(undefined), null)
  const { h, threads } = rig(new Date(2026, 9, 26, 8, 7).getTime())
  const m = await recordInbound(threads, delivery('a', 1, { sent_at: undefined }))
  assert.equal(m.hhmm, '08:07')
  h.now += MIN
  const text = await recordInbound(threads, delivery('b', 1, { sent_at: new Date(2026, 9, 26, 7, 30).toISOString() }))
  assert.equal(text.hhmm, '07:30', 'the time shown is the hub\'s, not the arrival')
})

test('a delivery without a turn number is not registered; a damaged registry starts over', async () => {
  const { h, threads } = rig()
  assert.equal(await recordInbound(threads, delivery('a', undefined, { turn: undefined })), null)
  assert.equal(seqOf({ seq: 5 }), 5)
  assert.equal(seqOf({ seq: 1, turn: 2 }), 2)
  h.reg = { threads: 'roto', marks: [] }
  assert.equal((await recordInbound(threads, delivery('a', 1))).n, 1)
})

test('activity is when a turn was sent: after a long sleep an old turn does not make its thread open beside a new one', async () => {
  const { h, threads } = rig()
  const start = h.now
  const sent = ms => new Date(ms).toISOString()
  await recordInbound(threads, delivery('old', 4, { sent_at: sent(start) }))
  h.now = start + 125 * MIN
  await recordInbound(threads, delivery('old', 5, { sent_at: sent(start + 5 * MIN) }))
  const fresh = await recordInbound(threads, delivery('new', 1, { sent_at: sent(h.now) }))
  assert.equal(fresh.crossed, false)
  assert.equal(h.reg.threads.old.last_at, start + 5 * MIN)
  const later = await recordInbound(threads, delivery('future', 1, { sent_at: sent(h.now + 60 * MIN) }))
  assert.equal(h.reg.threads.future.last_at, h.now, 'a sent_at ahead of the clock counts as now')
  assert.equal(later.crossed, true)
})
