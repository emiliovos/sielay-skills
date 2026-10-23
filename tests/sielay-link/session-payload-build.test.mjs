// The poll's session payload: a failure while reading the build never stops
// the poll (it goes without `build`, and the log names only the error's kind),
// and the identity comes from the project root, not the live cwd.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSessionPayload, sessionDir } from '../../plugins/sielay-link/mod/link-session-payload.js'
import { cwdHash } from '../../plugins/sielay-link/mod/link-session-name-resolution.js'

function engine({ buildThrows, root }) {
  const logs = []
  const $ = {
    session: { id: async () => 'sess-1', cwd: async () => '/srv/p', root: root ?? (async () => { throw new TypeError('$.session.root is not a function') }) },
    clock: { now: async () => 1_000_000 },
    env: { get: async () => undefined },
    store: { get: async () => undefined, set: async () => {} },
    fs: { exists: async () => false, read: async () => '' },
    state: {
      get: async ref => {
        if (ref.key === 'build' && buildThrows) throw new TypeError('secreto-en-el-mensaje')
        return { value: undefined, version: 0 }
      },
      set: async () => ({ isSet: true, version: 1 }),
    },
    ui: { log: t => void logs.push(t) },
  }
  return { $, logs, rt: { adapter: null, tmux: { at: 0 }, buildCarry: null, buildError: null } }
}

test('a build read that throws: the poll payload is still built, without build, and the log carries no message text', async () => {
  const h = engine({ buildThrows: true })
  const { session } = await buildSessionPayload(h.$, h.rt, { withBuild: true })
  assert.equal(session.name, 'p')
  assert.equal('build' in session, false)
  assert.deepEqual(h.logs, ['sielay-link: build no enviado, falló al leerlo (TypeError)'])
})

test('no build declared: no build key and nothing logged', async () => {
  const h = engine({ buildThrows: false })
  const { session } = await buildSessionPayload(h.$, h.rt, { withBuild: true })
  assert.equal('build' in session, false)
  assert.deepEqual(h.logs, [])
})

test('identity follows the project root, not the live cwd: a shell cd into another project keeps the name and hash', async () => {
  const h = engine({ root: async () => '/home/ft' })
  const { session } = await buildSessionPayload(h.$, h.rt)
  assert.equal(session.name, 'ft')
  assert.equal(session.cwd_hash, await cwdHash('/home/ft'))
  assert.equal(await sessionDir(h.$), '/home/ft')
})

test('without root(), or when root() fails, the live cwd is the identity', async () => {
  assert.equal(await sessionDir(engine({}).$), '/srv/p')
  assert.equal(await sessionDir(engine({ root: async () => { throw new Error('no') } }).$), '/srv/p')
})

/** A fake `$` whose folder, saved names, title, env and files the test moves. */
function movable() {
  const w = { root: '/srv/alpha', saved: new Map(), title: undefined, env: {}, files: new Set(), store: new Map(), now: 1_000_000 }
  const $ = {
    session: { id: async () => 'sess-1', cwd: async () => w.root, root: async () => w.root },
    clock: { now: async () => w.now },
    env: { get: async k => w.env[k] },
    store: {
      get: async k => (k.startsWith('name.') ? w.saved.get(k) : structuredClone(w.store.get(k))),
      set: async (k, v) => void w.store.set(k, structuredClone(v)),
    },
    fs: { exists: async p => w.files.has(p), read: async () => '' },
    state: {
      get: async ref => ({ value: ref.key === 'sessionTitle' ? w.title : undefined, version: 0 }),
      set: async () => ({ isSet: true, version: 1 }),
    },
    ui: { log: () => {} },
  }
  const rt = { adapter: { tmuxSessionName: async () => w.tmux }, tmux: { at: -Infinity }, buildCarry: null, buildError: null, namePin: null }
  return { w, $, rt }
}

test('the identity is fixed when the session starts: a /cd or worktree switch keeps name, hash and instance_id (no name-2 on the hub)', async () => {
  const h = movable()
  const first = await buildSessionPayload(h.$, h.rt)
  assert.deepEqual([first.session.name, first.nameSource], ['alpha', 'folder'])
  h.w.root = '/srv/beta'
  const moved = await buildSessionPayload(h.$, h.rt)
  assert.deepEqual([moved.session.name, moved.nameSource], ['alpha', 'folder'])
  assert.equal(moved.session.cwd_hash, await cwdHash('/srv/alpha'))
  assert.equal(moved.session.instance_id, first.session.instance_id)
})

test('inside tmux, a tmux name that could not be read yet leaves nothing fixed; it is fixed once read', async () => {
  const h = movable()
  h.w.env.TMUX = '/tmp/tmux-1/default,1,0'
  assert.equal((await buildSessionPayload(h.$, h.rt)).session.name, 'alpha')
  assert.equal(h.rt.namePin, null)
  h.w.tmux = 'mi-tmux'
  h.rt.tmux.at = -Infinity // the 5 min refresh came due
  assert.equal((await buildSessionPayload(h.$, h.rt)).session.name, 'mi-tmux')
  assert.equal(h.rt.namePin.source, 'tmux')
})

test('a title that arrives after the start does not rename the session; tmux and SIELAY_LINK_NAME win over the folder at the start', async () => {
  const h = movable()
  await buildSessionPayload(h.$, h.rt)
  h.w.title = 'Otro Título'
  assert.equal((await buildSessionPayload(h.$, h.rt)).session.name, 'alpha')

  const t = movable()
  t.w.tmux = 'mi-tmux'
  assert.deepEqual([(await buildSessionPayload(t.$, t.rt)).session.name, t.rt.namePin.source], ['mi-tmux', 'tmux'])
  t.w.root = '/srv/beta'
  assert.equal((await buildSessionPayload(t.$, t.rt)).session.name, 'mi-tmux')

  const e = movable()
  e.w.env.SIELAY_LINK_NAME = 'Fijo'
  e.w.tmux = 'mi-tmux'
  assert.equal((await buildSessionPayload(e.$, e.rt)).session.name, 'fijo')
})

test('/link name clears the pin: the next payload takes the saved name and fixes it again', async () => {
  const h = movable()
  await buildSessionPayload(h.$, h.rt)
  h.w.saved.set(`name.${await cwdHash('/srv/alpha')}`, 'elegido')
  assert.equal((await buildSessionPayload(h.$, h.rt)).session.name, 'alpha', 'saved alone does not move the pin')
  h.rt.namePin = null // what /link name does after saving
  assert.deepEqual([(await buildSessionPayload(h.$, h.rt)).session.name, h.rt.namePin.source], ['elegido', 'saved'])
  h.w.root = '/srv/beta'
  h.w.saved.set(`name.${await cwdHash('/srv/beta')}`, 'otro')
  h.rt.namePin = null // /link name after a /cd fixes the new folder with it
  const renamed = await buildSessionPayload(h.$, h.rt)
  assert.deepEqual([renamed.session.name, renamed.session.cwd_hash], ['otro', await cwdHash('/srv/beta')])
})

test('nothing is fixed before the adapter can read tmux (the loop has not started)', async () => {
  const h = movable()
  h.rt.adapter = null
  await buildSessionPayload(h.$, h.rt)
  assert.equal(h.rt.namePin, null)
})

test('a quick restart whose old socket file lingers reuses its instance_id: the PID behind the socket is checked', async () => {
  const h = movable()
  h.w.files.add('/proc/self')
  h.w.env.CLAUDE_CODE_MESSAGING_SOCKET = '/run/user/1/cc-socks/100.sock'
  h.w.files.add('/run/user/1/cc-socks/100.sock').add('/proc/100')
  const before = (await buildSessionPayload(h.$, h.rt)).session.instance_id

  const next = movable() // a new process: new runtime, new socket, same machine store
  next.w.store = h.w.store
  next.w.files = new Set(['/proc/self', '/run/user/1/cc-socks/100.sock', '/run/user/1/cc-socks/200.sock', '/proc/200'])
  next.w.env.CLAUDE_CODE_MESSAGING_SOCKET = '/run/user/1/cc-socks/200.sock'
  next.w.now = h.w.now + 5_000
  assert.equal((await buildSessionPayload(next.$, next.rt)).session.instance_id, before)

  const twin = movable() // a second live terminal in the same folder still gets its own id
  twin.w.store = next.w.store
  twin.w.files = new Set([...next.w.files, '/run/user/1/cc-socks/300.sock', '/proc/300'])
  twin.w.env.CLAUDE_CODE_MESSAGING_SOCKET = '/run/user/1/cc-socks/300.sock'
  twin.w.now = next.w.now + 1_000
  assert.notEqual((await buildSessionPayload(twin.$, twin.rt)).session.instance_id, before)
})
