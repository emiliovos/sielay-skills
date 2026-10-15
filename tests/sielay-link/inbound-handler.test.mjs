import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createInboundHandler } from '../../plugins/sielay-link/mod/link-inbound-handler.js'

function memStore() {
  const m = new Map()
  return { m, get: async k => structuredClone(m.get(k)), set: async (k, v) => void m.set(k, structuredClone(v)) }
}
const stripped = { id: 'm7', conversation_id: 'c', turn: 1, max_turns: 10, from: { address: 'a/b/c' }, body: 'hola', run: 0, gate: 'strip' }

function handler(store, inject) {
  let strip = []
  const h = createInboundHandler({ store, adapter: { inject }, readMode: async () => ({ mode: 'default', fresh: false }), onStrip: async s => void (strip = s) })
  return { h, strip: () => strip }
}

test('accepted but not delivered: kept in the store and delivered on the next poll, also after a reload', async () => {
  const store = memStore()
  let fail = true
  const injected = []
  const inject = async text => { if (fail) throw new Error('socket down'); injected.push(text) }
  const first = handler(store, inject)
  await first.h.handlePoll('inst', { messages: [], strip: [stripped] })
  const decisions = []
  const ctx = { instanceId: 'inst', decide: async d => void decisions.push(d), ack: async () => {} }
  const r = await first.h.accept('m7', ctx)
  assert.equal(r.ok, false)
  assert.deepEqual(decisions, ['accepted'])
  assert.ok(store.m.get('accepted.inst')?.m7, 'pending accepted message persisted')

  // A reloaded copy of the mod (fresh handler, same store) retries it.
  fail = false
  const second = handler(store, inject)
  const acks = await second.h.handlePoll('inst', { messages: [], strip: [] })
  assert.deepEqual(acks, [{ id: 'm7', outcome: 'injected' }])
  assert.equal(injected.length, 1)
  assert.deepEqual(store.m.get('accepted.inst'), {})
  assert.deepEqual(await second.h.handlePoll('inst', { messages: [], strip: [] }), [], 'delivered once')
})

test('a retried Accept after a failed delivery does not decide twice', async () => {
  const store = memStore()
  let fail = true
  const inject = async () => { if (fail) throw new Error('down') }
  const { h } = handler(store, inject)
  await h.handlePoll('inst', { messages: [], strip: [stripped] })
  const decisions = []
  const ctx = { instanceId: 'inst', decide: async d => void decisions.push(d), ack: async () => {} }
  await h.accept('m7', ctx)
  fail = false
  assert.deepEqual(await h.accept('m7', ctx), { ok: true })
  assert.deepEqual(decisions, ['accepted'])
})

test('accept and reject act on the exact id asked for, never on "the first"', async () => {
  const store = memStore()
  const injected = []
  const { h } = handler(store, async t => void injected.push(t))
  const other = { ...stripped, id: 'm8', body: 'otro' }
  await h.handlePoll('inst', { messages: [], strip: [stripped, other] })
  const ctx = { instanceId: 'inst', decide: async () => {}, ack: async () => {} }
  await h.accept('m8', ctx)
  assert.equal(injected.length, 1)
  assert.match(injected[0], /otro$/)
  assert.deepEqual(h.currentStrip().map(d => d.id), ['m7'])
  assert.equal((await h.accept('nope', ctx)).ok, false)
})

test('the strip keeps arrival order, so the item shown first does not change under the person', async () => {
  const { h } = handler(memStore(), async () => {})
  await h.handlePoll('inst', { messages: [], strip: [stripped] })
  await h.handlePoll('inst', { messages: [], strip: [{ ...stripped, id: 'm0', seq: 0 }, stripped] })
  assert.equal(h.currentStrip()[0].id, 'm7')
})

test('an accepted redelivery is never acked shown: a failed write sends no ack and keeps it out of the strip', async () => {
  const store = memStore()
  let fail = true
  const injected = []
  const { h, strip } = handler(store, async t => { if (fail) throw new Error('socket down'); injected.push(t) })
  const accepted = { ...stripped, id: 'acc-1', run: 1, gate: 'accepted' }
  assert.deepEqual(await h.handlePoll('inst', { messages: [accepted], strip: [] }), [], 'no ack while the write fails')
  assert.deepEqual(strip(), [])
  fail = false
  assert.deepEqual(await h.handlePoll('inst', { messages: [accepted], strip: [] }), [{ id: 'acc-1', outcome: 'injected' }])
  assert.equal(injected.length, 1)
  assert.deepEqual(await h.handlePoll('inst', { messages: [accepted], strip: [] }), [{ id: 'acc-1', outcome: 'injected' }], 'redelivered again: re-acked, not re-injected')
  assert.equal(injected.length, 1)
})
