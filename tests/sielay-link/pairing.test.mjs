import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPairingFlow } from '../../plugins/sielay-link/mod/link-pairing.js'

const START = { device_code: 'dev-code', user_code: 'ABCD-1234', verification_uri: 'https://sielay.cloud/enroll?link=7', expires_in: 600, interval: 5 }

function harness({ polls, writeFails = false, start = START } = {}) {
  const events = []
  const timers = []
  let clock = 0
  let n = 0
  const flow = createPairingFlow({
    makeClient: () => ({
      origin: 'https://sielay.cloud',
      pairStart: async body => (events.push(['start', body]), start),
      pairPoll: async () => polls[Math.min(n++, polls.length - 1)],
    }),
    schedule: (ms, fn) => timers.push({ ms, fn }),
    now: async () => clock,
    setView: async view => void events.push(['view', structuredClone(view)]),
    writeTokenFile: async token => {
      events.push(['write', token])
      if (writeFails) throw new Error('no sh')
    },
    onToken: async (token, info) => void events.push(['activate', token, info]),
    hostname: async () => 'box-1',
    clientVersion: '1.0.0',
    tokenPath: '~/.claude/sielay-link/token',
  })
  async function fire() {
    const t = timers.shift()
    clock += t.ms
    t.fn()
    for (let i = 0; i < 5; i += 1) await new Promise(r => setImmediate(r))
    return t.ms
  }
  return { flow, events, timers, fire }
}

test('an invalid slot is refused without contacting the hub', async () => {
  const h = harness({ polls: [] })
  const r = await h.flow.start('Bad Slot!')
  assert.equal(r.ok, false)
  assert.equal(h.events.length, 0)
})

test('start shows the user code, then polls at the hub interval', async () => {
  const h = harness({ polls: [{ status: 'authorization_pending' }] })
  const r = await h.flow.start('ana-laptop')
  assert.equal(r.ok, true)
  assert.match(r.text, /ABCD-1234/)
  assert.deepEqual(h.events[0], ['start', { slot: 'ana-laptop', hostname: 'box-1', client_version: '1.0.0' }])
  assert.equal(h.events[1][1].phase, 'waiting')
  assert.equal(h.events[1][1].user_code, 'ABCD-1234')
  assert.equal(h.timers[0].ms, 5000)
})

test('slow_down adds 5 s; expiry ends the wait with an error view', async () => {
  const h = harness({ polls: [{ status: 'slow_down' }, { status: 'authorization_pending' }] })
  await h.flow.start('ana-laptop')
  await h.fire()
  assert.equal(h.timers[0].ms, 10_000)
  while (h.timers.length) await h.fire()
  const last = h.events.filter(e => e[0] === 'view').at(-1)[1]
  assert.equal(last.phase, 'error')
  assert.match(last.message, /venció/)
})

test('denied and expired_token end the flow', async () => {
  for (const status of ['access_denied', 'expired_token']) {
    const h = harness({ polls: [{ status }] })
    await h.flow.start('ana-laptop')
    await h.fire()
    assert.equal(h.timers.length, 0)
    assert.equal(h.events.at(-1)[1].phase, 'error')
  }
})

test('the token is on screen BEFORE it is written, then saved and activated', async () => {
  const h = harness({ polls: [{ status: 'ok', token: 'tok-123', address_prefix: 'ana/laptop', hub_url: 'https://sielay.cloud' }] })
  await h.flow.start('ana-laptop')
  await h.fire()
  const shownAt = h.events.findIndex(e => e[0] === 'view' && e[1].token === 'tok-123')
  const writeAt = h.events.findIndex(e => e[0] === 'write')
  assert.ok(shownAt >= 0 && writeAt > shownAt, 'shown first, then written')
  const final = h.events.filter(e => e[0] === 'view').at(-1)[1]
  assert.equal(final.saved, 'file')
  assert.deepEqual(h.events.at(-1), ['activate', 'tok-123', { address_prefix: 'ana/laptop', hub_url: 'https://sielay.cloud' }])
})

test('when the file cannot be written the token stays on screen with the /plugin fallback', async () => {
  const h = harness({ polls: [{ status: 'ok', token: 'tok-9', address_prefix: 'a/b', hub_url: 'https://sielay.cloud' }], writeFails: true })
  await h.flow.start('ana-laptop')
  await h.fire()
  const final = h.events.filter(e => e[0] === 'view').at(-1)[1]
  assert.equal(final.token, 'tok-9')
  assert.equal(final.saved, 'failed')
  assert.match(final.note, /\/plugin/)
  assert.ok(h.events.some(e => e[0] === 'activate'), 'still usable for this session')
})

test('a verification link outside the hub origin is not shown', async () => {
  const h = harness({ polls: [{ status: 'authorization_pending' }], start: { ...START, verification_uri: 'https://evil.example/x' } })
  await h.flow.start('ana-laptop')
  assert.equal(h.events[1][1].verification_uri, undefined)
})

test('a second start cancels the first wait', async () => {
  const h = harness({ polls: [{ status: 'authorization_pending' }] })
  await h.flow.start('ana-laptop')
  const stale = h.timers.shift()
  await h.flow.start('ana-laptop')
  stale.fn()
  await new Promise(r => setImmediate(r))
  assert.equal(h.timers.length, 1, 'the stale timer did not reschedule')
})
