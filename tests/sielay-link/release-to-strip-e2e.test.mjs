// Client E2E for the dashboard release (held → strip → Accept): fake hub over
// node:http, the real hub client, loop, gate and handler, and a fake adapter.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeHub, httpToFakeHub } from './fake-hub-server.mjs'
import { createHubClient as createHubClientFor } from '../../plugins/sielay-link/mod/link-hub-client.js'

// The client takes `$` first; tests hand it a fake with only `http.fetch`.
const createHubClient = ({ hubUrl, token, http }) => createHubClientFor({ http }, { hubUrl, token })
import { createPollLoop } from '../../plugins/sielay-link/mod/link-poll-loop.js'
import { createInboundHandler } from '../../plugins/sielay-link/mod/link-inbound-handler.js'

const TOKEN = 'e2e-token-not-real'

function memStore() {
  const m = new Map()
  return { get: async k => m.get(k), set: async (k, v) => void m.set(k, v) }
}

async function setup({ mode }) {
  const hub = await startFakeHub({ token: TOKEN })
  const client = createHubClient({ hubUrl: 'https://sielay.cloud', token: TOKEN, http: httpToFakeHub(hub.port) })
  const injected = []
  let strip = []
  const session = { name: 'api', instance_id: 'inst-e2e', cwd_hash: 'h', mode: mode.mode, mode_fresh: mode.fresh ? 1 : 0, state: 'idle' }
  const handler = createInboundHandler({
    store: memStore(),
    adapter: { inject: async text => void injected.push(text) },
    readMode: async () => mode,
    onStrip: async items => void (strip = items),
  })
  const timers = []
  const loop = createPollLoop({
    schedule: (ms, fn) => timers.push(fn),
    getClient: () => client,
    buildSession: async () => session,
    handler,
    isOff: async () => false,
  })
  async function pollOnce() {
    const fn = timers.shift()
    fn()
    for (let i = 0; i < 50 && timers.length === 0; i += 1) await new Promise(r => setTimeout(r, 5))
  }
  const ctx = {
    instanceId: session.instance_id,
    decide: decision => client.decide({ session, id: 'm-held', decision }),
    ack: a => client.ack({ session, ack: [a] }),
  }
  return { hub, loop, pollOnce, injected, getStrip: () => strip, handler, ctx }
}

const delivery = { id: 'm-held', conversation_id: 'c9', seq: 1, turn: 1, max_turns: 10, from: { address: 'ana/laptop/api', mode: 'default' }, body: 'corre los tests' }

for (const mode of [{ mode: 'default', fresh: true }, { mode: 'bypassPermissions', fresh: true }]) {
  test(`release → strip → Accept injects exactly once (receiver in ${mode.mode})`, async () => {
    const t = await setup({ mode })
    try {
      t.hub.hold(delivery)
      t.loop.start()
      await t.pollOnce()
      assert.deepEqual(t.getStrip(), [], 'a held message never appears in a poll')
      assert.equal(t.injected.length, 0)

      t.hub.release('m-held')
      await t.pollOnce()
      assert.deepEqual(t.getStrip().map(d => [d.id, d.run]), [['m-held', 0]], 'released → strip with run=0')
      assert.equal(t.injected.length, 0, 'release never injects, even in bypass')

      const r = await t.handler.accept('m-held', t.ctx)
      assert.deepEqual(r, { ok: true })
      assert.equal(t.injected.length, 1)
      assert.match(t.injected[0], /^\[sielay-link de=ana\/laptop\/api conv=c9 turno=1\/10 verificado-por-hub — responde con link_reply\]\n\ncorre los tests$/)
      const paths = t.hub.log.map(l => l.path)
      const decideAt = paths.indexOf('/api/link/decide')
      const ackAt = paths.indexOf('/api/link/ack')
      assert.ok(decideAt >= 0 && ackAt > decideAt, 'decide, then ack')
      assert.deepEqual(t.hub.log[decideAt].body.decision, 'accepted')
      assert.deepEqual(t.hub.log[ackAt].body.ack, [{ id: 'm-held', outcome: 'injected' }])
      assert.ok(t.hub.log.every(l => l.auth === `Bearer ${TOKEN}`))

      await t.pollOnce()
      assert.deepEqual(t.getStrip(), [], 'gone from the strip after Accept')
      assert.equal((await t.handler.accept('m-held', t.ctx)).ok, false, 'a second Accept does nothing')
      assert.equal(t.injected.length, 1)
    } finally {
      t.loop.stop()
      await t.hub.close()
    }
  })
}

test('Reject in the strip decides rejected and never injects', async () => {
  const t = await setup({ mode: { mode: 'default', fresh: true } })
  try {
    t.hub.hold(delivery)
    t.hub.release('m-held')
    t.loop.start()
    await t.pollOnce()
    assert.deepEqual(await t.handler.reject('m-held', t.ctx), { ok: true })
    assert.equal(t.hub.messages.get('m-held').gate, 'rejected')
    assert.equal(t.injected.length, 0)
    assert.deepEqual(t.getStrip(), [])
  } finally {
    t.loop.stop()
    await t.hub.close()
  }
})

test('an auto message to an idle receiver under strict-like stale mode lands in the strip', async () => {
  const t = await setup({ mode: { mode: 'bypassPermissions', fresh: false } })
  try {
    t.hub.messages.set('m-auto', { delivery: { ...delivery, id: 'm-auto' }, gate: 'auto', status: 'queued' })
    t.loop.start()
    await t.pollOnce()
    assert.equal(t.injected.length, 0)
    assert.deepEqual(t.getStrip().map(d => d.id), ['m-auto'])
  } finally {
    t.loop.stop()
    await t.hub.close()
  }
})
