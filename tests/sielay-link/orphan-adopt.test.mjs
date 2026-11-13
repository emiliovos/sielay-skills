import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adoptOrphans, claimInstanceId, instanceKey, INSTANCE_LEASE_MS } from '../../plugins/sielay-link/mod/link-instance-identity.js'
import { createInbox } from '../../plugins/sielay-link/mod/link-inbox.js'
import { createHeldQueue } from '../../plugins/sielay-link/mod/link-quiet-hold.js'
import { createInboundStore } from '../../plugins/sielay-link/mod/link-inbound-store.js'
import { unreadLine } from '../../plugins/sielay-link/mod/link-discovery-context.js'

function memStore() {
  const m = new Map()
  return { m, get: async k => structuredClone(m.get(k)), set: async (k, v) => void m.set(k, structuredClone(v)) }
}

const msg = (id, conv = 'c') => ({ id, conversation_id: conv, turn: 1, max_turns: 10, from: { address: 'a/b/c' }, body: `body ${id}`, run: 1, gate: 'auto' })

/** One machine: a store, a clock, the claim, and the same adoption the runtime wires. */
function machine() {
  const store = memStore()
  const w = { store, clock: 1_000_000, n: 0 }
  w.inbox = createInbox(store, () => w.clock)
  const { readHeld, writeHeld } = createInboundStore(store)
  w.held = createHeldQueue({ readHeld, writeHeld, quietRule: async () => null, isBusy: () => false, now: () => w.clock, mayRun: async () => true, inject: async () => {}, log: () => {} })
  w.readHeld = readHeld
  /** Claim then adopt, as one poll does; sess: owners are always «alive». */
  w.poll = async (me, key = instanceKey('h', 'api')) => {
    const common = { store, key, now: w.clock, ownerAlive: async () => true }
    const id = await claimInstanceId({ ...common, me, newId: () => `inst-${(w.n += 1)}` })
    const adopted = []
    await adoptOrphans({ ...common, mine: id, adopt: async (from, to) => {
      await w.inbox.adopt(from, to)
      await w.held.adopt(from, to)
      adopted.push(from)
    } })
    return { id, adopted }
  }
  return w
}

test('(a) a /clear without a socket inside the lease mints another id, and nothing is adopted yet', async () => {
  const w = machine()
  const before = await w.poll('sess:A')
  await w.inbox.add(before.id, msg('m1'))
  w.clock += 10_000
  const after = await w.poll('sess:B')
  assert.notEqual(after.id, before.id, 'the gap: the old record is still held, so a new id is minted')
  assert.deepEqual(after.adopted, [])
  assert.deepEqual(await w.store.get(`inbox.${before.id}`).then(v => v.map(e => e.d.id)), ['m1'])
})

test('(b) once the lease lapses, the unread and the held of the old id reach the new one, once', async () => {
  const w = machine()
  const old = await w.poll('sess:A')
  await w.inbox.add(old.id, msg('m1'))
  await w.inbox.add(old.id, msg('m2'))
  assert.equal((await w.inbox.take(old.id, 'c')).length, 2) // m1 and m2 are read here...
  await w.inbox.add(old.id, msg('m3', 'd')) // ...so only m3 stays unread
  await w.held.add(old.id, msg('h1'))
  w.clock += 10_000
  const fresh = await w.poll('sess:B')
  w.clock += INSTANCE_LEASE_MS + 1
  const again = await w.poll('sess:B')
  assert.equal(again.id, fresh.id)
  assert.deepEqual(again.adopted, [old.id])
  assert.deepEqual((await w.inbox.take(again.id)).map(d => d.id), ['m3'], 'only the unread moved, read ones stay behind')
  assert.deepEqual((await w.readHeld(again.id)).map(h => h.delivery.id), ['h1'])
  assert.deepEqual(await w.store.get(`held.${old.id}`), [])
  assert.deepEqual(await w.store.get(`inbox.${old.id}`), [])
  assert.deepEqual((await w.store.get(instanceKey('h', 'api'))).map(r => r.instance_id), [again.id], 'the record is gone from the list')
  // a second poll adopts nothing more and duplicates nothing
  assert.deepEqual((await w.poll('sess:B')).adopted, [])
  assert.deepEqual((await w.readHeld(again.id)).map(h => h.delivery.id), ['h1'])
})

test('(b) a message already in the new id is not duplicated and keeps its time', async () => {
  const w = machine()
  const old = await w.poll('sess:A')
  w.clock += 1
  const fresh = await w.poll('sess:B')
  await w.inbox.add(old.id, msg('same'))
  const oldAt = w.clock
  w.clock += 5
  await w.inbox.add(fresh.id, msg('same'))
  await w.inbox.add(old.id, msg('only-old'))
  await w.held.add(old.id, msg('hh'))
  await w.held.add(fresh.id, msg('hh'))
  assert.equal(await w.inbox.adopt(old.id, fresh.id), 1)
  assert.equal(await w.held.adopt(old.id, fresh.id), 0)
  const entries = await w.store.get(`inbox.${fresh.id}`)
  assert.deepEqual(entries.map(e => e.d.id).sort(), ['only-old', 'same'])
  assert.equal(entries.find(e => e.d.id === 'only-old').at, w.clock, 'at is conserved')
  assert.ok(oldAt < w.clock)
  assert.equal((await w.readHeld(fresh.id)).length, 1)
})

test('(c) a record whose owner lives and renews keeps its mailboxes', async () => {
  const w = machine()
  const other = await w.poll('sess:A')
  await w.inbox.add(other.id, msg('m1'))
  await w.held.add(other.id, msg('h1'))
  w.clock += INSTANCE_LEASE_MS - 1_000
  const mine = await w.poll('sess:B')
  assert.deepEqual(mine.adopted, [])
  assert.equal((await w.store.get(`inbox.${other.id}`)).length, 1)
  assert.equal((await w.readHeld(other.id)).length, 1)
  assert.equal((await w.store.get(instanceKey('h', 'api'))).length, 2)
})

test('(d) another folder or another name is never touched', async () => {
  const w = machine()
  const elsewhere = await w.poll('sess:X', instanceKey('other-folder', 'api'))
  const renamed = await w.poll('sess:Y', instanceKey('h', 'web'))
  for (const r of [elsewhere, renamed]) {
    await w.inbox.add(r.id, msg(`m-${r.id}`))
    await w.held.add(r.id, msg(`h-${r.id}`))
  }
  w.clock += INSTANCE_LEASE_MS + 1
  const mine = await w.poll('sess:B')
  assert.deepEqual(mine.adopted, [])
  for (const r of [elsewhere, renamed]) {
    assert.equal((await w.store.get(`inbox.${r.id}`)).length, 1)
    assert.equal((await w.readHeld(r.id)).length, 1)
  }
  assert.equal((await w.store.get(instanceKey('other-folder', 'api'))).length, 1)
})

test('a move that fails keeps the record so the next poll retries', async () => {
  const w = machine()
  const old = await w.poll('sess:A')
  await w.inbox.add(old.id, msg('m1'))
  w.clock += 1
  const fresh = await w.poll('sess:B')
  w.clock += INSTANCE_LEASE_MS + 1
  const common = { store: w.store, key: instanceKey('h', 'api'), now: w.clock, ownerAlive: async () => true, mine: fresh.id }
  await assert.rejects(adoptOrphans({ ...common, adopt: async () => { throw new Error('store down') } }), /store down/)
  assert.equal((await w.store.get(instanceKey('h', 'api'))).length, 2)
  assert.deepEqual((await w.poll('sess:B')).adopted, [old.id])
})

test('adopting does not step on a simultaneous add: both messages survive', async () => {
  const w = machine()
  await w.inbox.add('old', msg('m1'))
  await Promise.all([w.inbox.adopt('old', 'new'), w.inbox.add('new', msg('m2')), w.inbox.add('new', msg('m3'))])
  assert.deepEqual((await w.inbox.take('new')).map(d => d.id).sort(), ['m1', 'm2', 'm3'])
})

test('(e) the notice counts the unread, with the adopted ones, and is silent without any', async () => {
  const w = machine()
  assert.equal(await w.inbox.unreadCount('inst'), 0)
  assert.equal(unreadLine(0), null)
  await w.inbox.add('old', msg('m1'))
  await w.inbox.add('old', msg('m2', 'd'))
  await w.inbox.add('inst', msg('m3'))
  await w.inbox.adopt('old', 'inst')
  const n = await w.inbox.unreadCount('inst')
  assert.equal(n, 3)
  assert.equal(unreadLine(n), '📨 3 mensajes sin leer: llama link_read')
  assert.equal(unreadLine(1), '📨 1 mensaje sin leer: llama link_read')
  await w.inbox.take('inst')
  assert.equal(await w.inbox.unreadCount('inst'), 0)
})
