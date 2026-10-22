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
