import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claimInstanceId, instanceKey, socketOwnerAlive, INSTANCE_LEASE_MS, MAX_RECORDS, STALE_NO_PID_MS } from '../../plugins/sielay-link/mod/link-instance-identity.js'

function memStore() {
  const m = new Map()
  return { m, get: async k => structuredClone(m.get(k)), set: async (k, v) => void m.set(k, structuredClone(v)) }
}

function world() {
  const store = memStore()
  const alive = new Set()
  const unknown = new Set() // owners whose liveness cannot be told
  let n = 0
  const claim = (me, now, key = instanceKey('hash-a', 'api')) =>
    claimInstanceId({ store, key, me, now, ownerAlive: async o => (unknown.has(o) ? undefined : alive.has(o)), newId: () => `inst-${(n += 1)}` })
  return { store, alive, unknown, claim }
}

test('the key is per (cwd_hash, resolved name)', () => {
  assert.equal(instanceKey('h1', 'api'), 'instance.h1.api')
  assert.notEqual(instanceKey('h1', 'api'), instanceKey('h2', 'api'))
  assert.notEqual(instanceKey('h1', 'api'), instanceKey('h1', 'web'))
})

test('first claim mints and persists; the same live process (reload, /clear) keeps it', async () => {
  const w = world()
  w.alive.add('sock:A')
  const first = await w.claim('sock:A', 1_000)
  assert.equal(first, 'inst-1')
  assert.equal(await w.claim('sock:A', 2_000), 'inst-1', 'reload or /clear in the same terminal')
  assert.equal(w.store.m.get('instance.hash-a.api')[0].renewed_at, 2_000)
})

test('a restart or --resume in the same folder reuses the id once the old process is gone, even within 60 s', async () => {
  const w = world()
  w.alive.add('sock:A')
  await w.claim('sock:A', 1_000)
  w.alive.delete('sock:A') // the old CLI exited and took its socket with it
  w.alive.add('sock:B')
  assert.equal(await w.claim('sock:B', 6_000), 'inst-1', 'same instance: the hub sees "same", no api-2')
})

test('two live terminals in the same folder get distinct ids, each stable on its own reloads', async () => {
  const w = world()
  w.alive.add('sock:A')
  w.alive.add('sock:B')
  const a = await w.claim('sock:A', 1_000)
  const b = await w.claim('sock:B', 2_000)
  assert.notEqual(a, b)
  assert.equal(await w.claim('sock:A', 3_000), a)
  assert.equal(await w.claim('sock:B', 4_000), b)
  assert.equal(w.store.m.get('instance.hash-a.api').length, 2)
})

test('a live holder that stopped renewing past the lease keeps its id (/link off, a suspend)', async () => {
  const w = world()
  w.alive.add('sock:A')
  w.alive.add('sock:B')
  const a = await w.claim('sock:A', 0)
  const b = await w.claim('sock:B', INSTANCE_LEASE_MS * 10)
  assert.notEqual(b, a, 'lease lapsed but A still runs: never taken')
  assert.equal(await w.claim('sock:A', INSTANCE_LEASE_MS * 11), a, 'A comes back to its own id')
})

test('a holder whose process is gone is taken over (crash left its socket behind)', async () => {
  const w = world()
  w.alive.add('sock:A')
  const a = await w.claim('sock:A', 0)
  w.alive.delete('sock:A')
  w.alive.add('sock:B')
  assert.equal(await w.claim('sock:B', 5_000), a)
})

test('a socket whose liveness cannot be told (no procfs) is taken only after a day of silence', async () => {
  const w = world()
  w.unknown.add('sock:A') // the file stays and nothing says whether its process died
  w.alive.add('sock:B')
  const a = await w.claim('sock:A', 0)
  assert.notEqual(await w.claim('sock:B', STALE_NO_PID_MS - 1), a)
  w.store.m.set('instance.hash-a.api', [{ instance_id: a, owner: 'sock:A', renewed_at: 0 }])
  assert.equal(await w.claim('sock:B', STALE_NO_PID_MS + 1), a)
})

test('a socket owner proven alive keeps its id however long it stays silent (suspend, /link off)', async () => {
  const w = world()
  w.alive.add('sock:A')
  w.alive.add('sock:B')
  const a = await w.claim('sock:A', 0)
  assert.notEqual(await w.claim('sock:B', STALE_NO_PID_MS * 3), a)
})

test('a sess: owner whose pid cannot be checked (no procfs) is taken only after a day of silence', async () => {
  const w = world()
  const claim = (me, now, pid) => claimInstanceId({
    store: w.store, key: instanceKey('hash-a', 'api'), me, now, ownerAlive: async () => true,
    newId: () => `sess-${me}`, pid, pidAlive: async () => undefined,
  })
  const first = await claim('sess:S1', 0, 100)
  assert.notEqual(await claim('sess:T1', STALE_NO_PID_MS - 1, 200), first)
  w.store.m.set('instance.hash-a.api', [{ instance_id: first, owner: 'sess:S1', renewed_at: 0, pid: 100 }])
  assert.equal(await claim('sess:U1', STALE_NO_PID_MS + 1, 300), first)
})

test('without a socket, a /clear in the same process keeps the id; another live process does not take it', async () => {
  const w = world()
  const pids = new Set([100, 200])
  const claim = (me, now, pid) => claimInstanceId({
    store: w.store, key: instanceKey('hash-a', 'api'), me, now, ownerAlive: async () => true,
    newId: () => `sess-${me}`, pid, pidAlive: async p => pids.has(p),
  })
  const first = await claim('sess:S1', 0, 100)
  assert.equal(await claim('sess:S2', 1_000, 100), first, '/clear: new session id, same pid')
  assert.notEqual(await claim('sess:T1', INSTANCE_LEASE_MS * 10, 200), first, 'a live terminal with a lapsed lease keeps it')
  pids.delete(100)
  assert.equal(await claim('sess:U1', INSTANCE_LEASE_MS * 11, 300), first, 'its pid died: taken over')
})

test('a third terminal while two are live mints a third id; the list stays bounded', async () => {
  const w = world()
  for (let i = 0; i < MAX_RECORDS + 3; i += 1) {
    w.alive.add(`sock:${i}`)
    await w.claim(`sock:${i}`, 1_000 + i)
  }
  assert.ok(w.store.m.get('instance.hash-a.api').length <= MAX_RECORDS)
})

test('a malformed stored value is ignored, never trusted', async () => {
  const w = world()
  w.store.m.set('instance.hash-a.api', [{ instance_id: 42 }, 'x', null, { instance_id: 'ok-1', owner: 'sock:Z', renewed_at: 'yesterday' }])
  w.alive.add('sock:A')
  const id = await w.claim('sock:A', 1_000)
  assert.match(id, /^(ok-1|inst-1)$/)
  assert.ok(w.store.m.get('instance.hash-a.api').every(r => typeof r.instance_id === 'string' && typeof r.renewed_at === 'number'))
})

test('a socket owner is alive only while its file and the PID in its name are: a quick restart frees the old record', async () => {
  const files = new Set(['/proc/self', '/run/user/1/cc-socks/111.sock', '/proc/111', '/run/user/1/cc-socks/222.sock'])
  const exists = async p => files.has(p)
  assert.equal(await socketOwnerAlive('/run/user/1/cc-socks/111.sock', exists), true, 'live process, socket in place')
  assert.equal(await socketOwnerAlive('/run/user/1/cc-socks/222.sock', exists), false, 'socket left behind by a dead PID')
  assert.equal(await socketOwnerAlive('/run/user/1/cc-socks/333.sock', exists), false, 'socket gone')
  assert.equal(await socketOwnerAlive('/tmp/other-name.sock', async p => p === '/tmp/other-name.sock' || p === '/proc/self'), undefined, 'no PID in the name: cannot be told')
  assert.equal(await socketOwnerAlive('/var/x/444.sock', async p => p === '/var/x/444.sock'), undefined, 'no procfs (macOS): cannot be told')
  assert.equal(await socketOwnerAlive('/var/x/555.sock', async p => { if (p.startsWith('/proc')) throw new Error('denied'); return true }), undefined, 'procfs unreadable: cannot be told')
})

test('restart within the lease while the old socket file lingers: same instance_id, no name-2', async () => {
  const store = memStore()
  const files = new Set(['/proc/self', '/s/100.sock', '/proc/100'])
  const ownerAlive = async o => socketOwnerAlive(o.slice(5), async p => files.has(p))
  let n = 0
  const claim = (me, now) => claimInstanceId({ store, key: instanceKey('h', 'api'), me, now, ownerAlive, newId: () => `inst-${(n += 1)}` })
  assert.equal(await claim('sock:/s/100.sock', 1_000), 'inst-1')
  files.delete('/proc/100') // the CLI exited; its socket file stays on disk
  files.add('/s/200.sock')
  files.add('/proc/200')
  assert.equal(await claim('sock:/s/200.sock', 5_000), 'inst-1')
})
