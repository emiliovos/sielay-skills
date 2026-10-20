// The poll's session payload with a build: a failure while reading the build
// never stops the poll; it goes without `build`, and the log names only the
// error's kind.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSessionPayload } from '../../plugins/sielay-link/mod/link-session-payload.js'

function engine({ buildThrows }) {
  const logs = []
  const $ = {
    session: { id: async () => 'sess-1', cwd: async () => '/srv/p' },
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
