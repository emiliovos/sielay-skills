import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adoptOrphans, claimInstanceId, instanceKey, INSTANCE_LEASE_MS, STALE_NO_PID_MS } from '../../plugins/sielay-link/mod/link-instance-identity.js'
import { createInbox } from '../../plugins/sielay-link/mod/link-inbox.js'
import { createHeldQueue } from '../../plugins/sielay-link/mod/link-quiet-hold.js'
import { createInboundStore } from '../../plugins/sielay-link/mod/link-inbound-store.js'
import { unreadLine } from '../../plugins/sielay-link/mod/link-discovery-context.js'

function memStore() {
  const m = new Map()
  return { m, get: async k => structuredClone(m.get(k)), set: async (k, v) => void m.set(k, structuredClone(v)) }
}

const msg = (id, conv = 'c') => ({ id, conversation_id: conv, turn: 1, max_turns: 10, from: { address: 'a/b/c' }, body: `body ${id}`, run: 1, gate: 'auto' })

/**
 * One machine: a shared store and clock, and one «process» per pid with its OWN
 * inbox and held queue (as a restarted Claude Code has). `alive` is the set of
 * running pids; a process only sees another's mailboxes through the store.
 */
function machine() {
  const store = memStore()
  const w = { store, clock: 1_000_000, n: 0, alive: new Set(), readHeld: createInboundStore(store).readHeld }
  w.proc = pid => {
    w.alive.add(pid)
    const inbox = createInbox(store, () => w.clock)
    const { readHeld, writeHeld } = createInboundStore(store)
    const held = createHeldQueue({ readHeld, writeHeld, quietRule: async () => null, isBusy: () => false, now: () => w.clock, mayRun: async () => true, inject: async () => {}, log: () => {} })
    const common = (key = instanceKey('h', 'api')) => ({ store, key, now: w.clock, ownerAlive: async () => true, pid, pidAlive: async p => w.alive.has(p) })
    /** Claim then adopt, as one poll does; sess: owners count as alive, the pid decides. */
    const poll = async (me, key) => {
      const c = common(key)
      const id = await claimInstanceId({ ...c, me, newId: () => `inst-${(w.n += 1)}` })
      const adopted = []
      await adoptOrphans({ ...c, mine: id, adopt: async (from, to) => {
        await inbox.adopt(from, to)
        await held.adopt(from, to)
        adopted.push(from)
      } })
      return { id, adopted }
    }
    return { pid, inbox, held, poll, common }
  }
  return w
}

test('(a) a second live terminal inside the lease mints another id, and nothing is adopted', async () => {
  const w = machine()
  const [p1, p2] = [w.proc(101), w.proc(102)]
  const before = await p1.poll('sess:A')
  await p1.inbox.add(before.id, msg('m1'))
  w.clock += 10_000
  const after = await p2.poll('sess:B')
  assert.notEqual(after.id, before.id)
  assert.deepEqual(after.adopted, [])
  assert.deepEqual(await w.store.get(`inbox.${before.id}`).then(v => v.map(e => e.d.id)), ['m1'])
})

test('(a) a /clear in the same process (same pid, new session id) adopts at once', async () => {
  const w = machine()
  const p = w.proc(101)
  const before = await p.poll('sess:A')
  await p.inbox.add(before.id, msg('m1'))
  await p.held.add(before.id, msg('h1'))
  w.clock += 10_000
  const after = await p.poll('sess:B')
  assert.notEqual(after.id, before.id)
  assert.deepEqual(after.adopted, [before.id])
  assert.deepEqual((await p.inbox.take(after.id)).map(d => d.id), ['m1'])
  assert.deepEqual((await w.readHeld(after.id)).map(h => h.delivery.id), ['h1'])
})

test('(b) when the old process is gone, the unread and the held of the old id reach the new one, once', async () => {
  const w = machine()
  const p1 = w.proc(101)
  const old = await p1.poll('sess:A')
  await p1.inbox.add(old.id, msg('m1'))
  await p1.inbox.add(old.id, msg('m2'))
  assert.equal((await p1.inbox.take(old.id, 'c')).length, 2) // m1 and m2 are read here...
  await p1.inbox.add(old.id, msg('m3', 'd')) // ...so only m3 stays unread
  await p1.held.add(old.id, msg('h1'))
  w.alive.delete(101) // the restart: a new process, a new inbox
  w.clock += 10_000
  const p2 = w.proc(102)
  const again = await p2.poll('sess:B')
  assert.deepEqual(again.adopted, [old.id])
  assert.deepEqual((await p2.inbox.take(again.id)).map(d => d.id), ['m3'], 'only the unread moved, read ones stay behind')
  assert.deepEqual((await w.readHeld(again.id)).map(h => h.delivery.id), ['h1'])
  assert.deepEqual(await w.store.get(`held.${old.id}`), [])
  assert.deepEqual(await w.store.get(`inbox.${old.id}`), [])
  assert.deepEqual((await w.store.get(instanceKey('h', 'api'))).map(r => r.instance_id), [again.id], 'the record is gone from the list')
  // a second poll adopts nothing more and duplicates nothing
  assert.deepEqual((await p2.poll('sess:B')).adopted, [])
  assert.deepEqual((await w.readHeld(again.id)).map(h => h.delivery.id), ['h1'])
})

test('(b) a message already in the new id is not duplicated and keeps its time', async () => {
  const w = machine()
  const [p1, p2] = [w.proc(101), w.proc(102)]
  const old = await p1.poll('sess:A')
  w.clock += 1
  const fresh = await p2.poll('sess:B')
  await p1.inbox.add(old.id, msg('same'))
  const oldAt = w.clock
  w.clock += 5
  await p2.inbox.add(fresh.id, msg('same'))
  await p1.inbox.add(old.id, msg('only-old'))
  await p1.held.add(old.id, msg('hh'))
  await p2.held.add(fresh.id, msg('hh'))
  assert.equal(await p2.inbox.adopt(old.id, fresh.id), 1)
  assert.equal(await p2.held.adopt(old.id, fresh.id), 0)
  const entries = await w.store.get(`inbox.${fresh.id}`)
  assert.deepEqual(entries.map(e => e.d.id).sort(), ['only-old', 'same'])
  assert.equal(entries.find(e => e.d.id === 'only-old').at, w.clock, 'at is conserved')
  assert.ok(oldAt < w.clock)
  assert.equal((await w.readHeld(fresh.id)).length, 1)
})

test('(c) a live sess: owner keeps its mailboxes even when its lease lapsed (/link off, a suspend)', async () => {
  const w = machine()
  const [p1, p2] = [w.proc(101), w.proc(102)]
  const key = instanceKey('h', 'api')
  const other = await p1.poll('sess:A')
  await p1.inbox.add(other.id, msg('m1'))
  await p1.held.add(other.id, msg('h1'))
  const mine = await claimInstanceId({ ...p2.common(), me: 'sess:B', newId: () => 'Y' }) // inside the lease: another id
  assert.notEqual(mine, other.id)
  w.clock += INSTANCE_LEASE_MS * 3 // p1 stopped renewing but still runs
  const adopted = await adoptOrphans({ ...p2.common(), mine, adopt: async (from, to) => { await p2.inbox.adopt(from, to); await p2.held.adopt(from, to) } })
  assert.deepEqual(adopted, [])
  assert.equal((await w.store.get(`inbox.${other.id}`)).length, 1)
  assert.equal((await w.readHeld(other.id)).length, 1)
  assert.equal((await w.store.get(key)).length, 2)
})

test('(c) a live sock: owner with a lapsed lease keeps its mailboxes; a dead one loses them', async () => {
  const w = machine()
  const p = w.proc(102)
  const key = instanceKey('h', 'api')
  const sock = 'sock:/tmp/101.sock'
  await w.store.set(key, [{ instance_id: 'X', owner: sock, renewed_at: w.clock }, { instance_id: 'Y', owner: 'sock:/tmp/102.sock', renewed_at: w.clock }])
  await p.inbox.add('X', msg('m1'))
  w.clock += INSTANCE_LEASE_MS * 3
  const sockAlive = new Set([sock])
  const run = () => adoptOrphans({ ...p.common(), mine: 'Y', ownerAlive: async o => sockAlive.has(o), adopt: (from, to) => p.inbox.adopt(from, to).then(() => {}) })
  assert.deepEqual(await run(), [])
  assert.equal((await w.store.get('inbox.X')).length, 1)
  sockAlive.clear() // the process exits
  assert.deepEqual(await run(), ['X'])
  assert.deepEqual((await p.inbox.take('Y')).map(d => d.id), ['m1'])
})

test('(c) a sess: owner whose pid died is adopted, even inside the lease', async () => {
  const w = machine()
  const p1 = w.proc(101)
  const old = await p1.poll('sess:A')
  await p1.inbox.add(old.id, msg('m1'))
  w.alive.delete(101)
  const p2 = w.proc(102)
  const fresh = await p2.poll('sess:B')
  assert.deepEqual(fresh.adopted, [old.id])
  assert.deepEqual((await p2.inbox.take(fresh.id)).map(d => d.id), ['m1'])
})

test('(c) a record without a pid is adopted only after a day without renewal', async () => {
  const w = machine()
  const p2 = w.proc(102)
  const key = instanceKey('h', 'api')
  await w.store.set(key, [{ instance_id: 'legacy', owner: 'sess:A', renewed_at: w.clock }, { instance_id: 'Y', owner: 'sess:B', renewed_at: w.clock, pid: 102 }])
  const run = () => adoptOrphans({ ...p2.common(), mine: 'Y', adopt: (from, to) => p2.inbox.adopt(from, to).then(() => {}) })
  w.clock += INSTANCE_LEASE_MS * 10
  await p2.inbox.add('legacy', msg('m1'))
  assert.deepEqual(await run(), [], 'lapsed but not provably dead')
  w.clock += STALE_NO_PID_MS - INSTANCE_LEASE_MS * 10 - 1_000
  assert.deepEqual(await run(), [], 'just under a day')
  w.clock += 2_000
  assert.deepEqual(await run(), ['legacy'])
  assert.deepEqual((await p2.inbox.take('Y')).map(d => d.id), ['m1'])
})

test('(c) two processes adopting the same dead id at once do not duplicate its messages', async () => {
  const w = machine()
  const p1 = w.proc(101)
  const old = await p1.poll('sess:A')
  await p1.inbox.add(old.id, msg('m1'))
  await p1.held.add(old.id, msg('h1'))
  w.alive.delete(101)
  const [p2, p3] = [w.proc(102), w.proc(103)]
  const settle = () => new Promise(r => setTimeout(r, 10))
  const ids = []
  for (const [p, me] of [[p2, 'sess:B'], [p3, 'sess:C']]) {
    ids.push(await claimInstanceId({ ...p.common(), me, newId: () => `inst-${(w.n += 1)}` }))
  }
  const run = (p, id) => adoptOrphans({ ...p.common(), mine: id, settle, adopt: async (from, to) => {
    await p.inbox.adopt(from, to)
    await p.held.adopt(from, to)
  } })
  const results = await Promise.all([run(p2, ids[0]), run(p3, ids[1])])
  assert.equal(results.flat().length, 1, 'exactly one process adopted')
  const unread = (await Promise.all(ids.map(id => w.store.get(`inbox.${id}`)))).flatMap(v => v ?? [])
  const held = (await Promise.all(ids.map(id => w.readHeld(id)))).flat()
  assert.deepEqual(unread.map(e => e.d.id), ['m1'])
  assert.deepEqual(held.map(h => h.delivery.id), ['h1'])
})

test('(d) another folder or another name is never touched', async () => {
  const w = machine()
  const [p1, p2] = [w.proc(101), w.proc(102)]
  const elsewhere = await p1.poll('sess:X', instanceKey('other-folder', 'api'))
  const renamed = await p1.poll('sess:Y', instanceKey('h', 'web'))
  for (const r of [elsewhere, renamed]) {
    await p1.inbox.add(r.id, msg(`m-${r.id}`))
    await p1.held.add(r.id, msg(`h-${r.id}`))
  }
  w.alive.delete(101)
  w.clock += INSTANCE_LEASE_MS + 1
  const mine = await p2.poll('sess:B')
  assert.deepEqual(mine.adopted, [])
  for (const r of [elsewhere, renamed]) {
    assert.equal((await w.store.get(`inbox.${r.id}`)).length, 1)
    assert.equal((await w.readHeld(r.id)).length, 1)
  }
  assert.equal((await w.store.get(instanceKey('other-folder', 'api'))).length, 1)
})

test('a move that fails keeps the record so the next poll retries', async () => {
  const w = machine()
  const [p1, p2] = [w.proc(101), w.proc(102)]
  const old = await p1.poll('sess:A')
  await p1.inbox.add(old.id, msg('m1'))
  w.clock += 1
  const fresh = await claimInstanceId({ ...p2.common(), me: 'sess:B', newId: () => `inst-${(w.n += 1)}` })
  w.alive.delete(101)
  await assert.rejects(adoptOrphans({ ...p2.common(), mine: fresh, adopt: async () => { throw new Error('store down') } }), /store down/)
  assert.equal((await w.store.get(instanceKey('h', 'api'))).length, 2)
  assert.deepEqual((await p2.poll('sess:B')).adopted, [old.id])
})

test('adopting does not step on a simultaneous add: both messages survive', async () => {
  const w = machine()
  const p = w.proc(101)
  await p.inbox.add('old', msg('m1'))
  await Promise.all([p.inbox.adopt('old', 'new'), p.inbox.add('new', msg('m2')), p.inbox.add('new', msg('m3'))])
  assert.deepEqual((await p.inbox.take('new')).map(d => d.id).sort(), ['m1', 'm2', 'm3'])
})

test('(e) the notice counts the unread, with the adopted ones, and is silent without any', async () => {
  const w = machine()
  const [p1, p2] = [w.proc(101), w.proc(102)]
  assert.equal(await p2.inbox.unreadCount('inst'), 0)
  assert.equal(unreadLine(0), null)
  const old = await p1.poll('sess:A')
  await p1.inbox.add(old.id, msg('m1'))
  await p1.inbox.add(old.id, msg('m2', 'd'))
  const mine = await p2.poll('sess:B') // p1 is still alive: nothing adopted yet
  await p2.inbox.add(mine.id, msg('m3'))
  assert.equal(await p2.inbox.unreadCount(mine.id), 1)
  w.alive.delete(101)
  assert.deepEqual((await p2.poll('sess:B')).adopted, [old.id])
  const n = await p2.inbox.unreadCount(mine.id)
  assert.equal(n, 3)
  assert.equal(unreadLine(n), '📨 3 mensajes sin leer: llama link_read')
  assert.equal(unreadLine(1), '📨 1 mensaje sin leer: llama link_read')
  await p2.inbox.take(mine.id)
  assert.equal(await p2.inbox.unreadCount(mine.id), 0)
})
