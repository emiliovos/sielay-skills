import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createHubClient as createHubClientFor,
  normalizeHubUrl,
  HubError,
  ALLOWED_HUB_ORIGINS,
} from '../../plugins/sielay-link/mod/link-hub-client.js'

// The client takes `$` first; tests hand it a fake with only `http.fetch`.
const createHubClient = ({ hubUrl, token, http }) => createHubClientFor({ http }, { hubUrl, token })

const TOKEN = 'test-token-not-real'

/** A recording fake of `$.http.fetch`. */
function fakeFetch(responder) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) })
    const r = await responder(url, init)
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: r.headers ?? {}, text: r.text ?? JSON.stringify(r.json ?? {}) }
  }
  return { fetch, calls }
}

const ok = json => () => ({ status: 200, json })

test('the allow-list is exactly the two hub origins', () => {
  assert.deepEqual([...ALLOWED_HUB_ORIGINS], ['https://sielay.cloud', 'https://sielay.vostec.mx'])
})

test('hub_url: allow-listed origins pass, with or without a trailing slash', () => {
  assert.equal(normalizeHubUrl('https://sielay.cloud'), 'https://sielay.cloud')
  assert.equal(normalizeHubUrl('https://sielay.vostec.mx/'), 'https://sielay.vostec.mx')
  assert.equal(normalizeHubUrl(undefined), 'https://sielay.cloud')
  assert.equal(normalizeHubUrl(''), 'https://sielay.cloud')
})

for (const bad of [
  'https://evil.example',
  'http://sielay.cloud',
  'https://sielay.cloud.evil.example',
  'https://user@sielay.cloud',
  'https://sielay.cloud:8443',
  'https://sielay.cloud/api',
  'https://sielay.cloud/?x=1',
  'not a url',
  42,
]) {
  test(`hub_url ${JSON.stringify(bad)} is rejected at load`, () => {
    assert.throws(() => normalizeHubUrl(bad), err => err instanceof HubError && err.kind === 'hub_url')
    assert.throws(() => createHubClient({ hubUrl: bad, token: TOKEN, http: { fetch: async () => ({}) } }), HubError)
  })
}

test('poll: POST /api/link/poll with Bearer, JSON body and returned data', async () => {
  const f = fakeFetch(ok({ session: { id: 's1' }, messages: [], strip: [], poll_after_ms: 0 }))
  const client = createHubClient({ hubUrl: 'https://sielay.cloud', token: TOKEN, http: { fetch: f.fetch } })
  const body = { session: { name: 'api' }, ack: [{ id: 'm1', outcome: 'injected' }], wait_s: 25 }
  const data = await client.poll(body)
  assert.equal(data.session.id, 's1')
  const [call] = f.calls
  assert.equal(call.url, 'https://sielay.cloud/api/link/poll')
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.headers.authorization, `Bearer ${TOKEN}`)
  assert.equal(call.init.headers['content-type'], 'application/json')
  assert.deepEqual(call.body, body)
})

test('send, ack, decide, peers hit their routes', async () => {
  const f = fakeFetch(ok({}))
  const client = createHubClient({ hubUrl: 'https://sielay.vostec.mx', token: TOKEN, http: { fetch: f.fetch } })
  await client.send({ to: 'a/b/c' })
  await client.ack({ session: {}, ack: [] })
  await client.decide({ session: {}, id: 'm', decision: 'accepted' })
  await client.peers()
  assert.deepEqual(
    f.calls.map(c => `${c.init.method} ${c.url}`),
    [
      'POST https://sielay.vostec.mx/api/link/send',
      'POST https://sielay.vostec.mx/api/link/ack',
      'POST https://sielay.vostec.mx/api/link/decide',
      'GET https://sielay.vostec.mx/api/link/peers',
    ],
  )
  assert.equal(f.calls[3].init.body, undefined)
})

test('decide only accepts accepted|rejected', async () => {
  const client = createHubClient({ hubUrl: undefined, token: TOKEN, http: { fetch: fakeFetch(ok({})).fetch } })
  await assert.rejects(client.decide({ session: {}, id: 'm', decision: 'released' }), /decision/)
})

test('a call without a token fails before any request', async () => {
  const f = fakeFetch(ok({}))
  const client = createHubClient({ hubUrl: undefined, token: '', http: { fetch: f.fetch } })
  await assert.rejects(client.poll({}), err => err.kind === 'no_token')
  assert.equal(f.calls.length, 0)
})

test('a 3xx that reaches the client is an error, never followed by hand', async () => {
  for (const location of ['https://evil.example/api/link/poll', 'https://sielay.cloud/elsewhere']) {
    const client = createHubClient({ hubUrl: undefined, token: TOKEN, http: fakeFetch(() => ({ status: 301, headers: { location } })) })
    await assert.rejects(client.poll({}), err => err.kind === 'redirect' && err.status === 301)
  }
})

test('503 pauses, 401 stops, 429 backs off with retry-after', async () => {
  const cases = [
    [{ status: 503, json: { code: 'link_disabled' } }, 'paused', 'link_disabled'],
    [{ status: 401, json: {} }, 'unauthorized', undefined],
    [{ status: 429, headers: { 'retry-after': '7' }, json: {} }, 'rate_limited', undefined],
  ]
  for (const [resp, kind, code] of cases) {
    const client = createHubClient({ hubUrl: undefined, token: TOKEN, http: fakeFetch(() => resp) })
    await assert.rejects(client.poll({}), err => {
      assert.equal(err.kind, kind)
      assert.equal(err.status, resp.status)
      if (code) assert.equal(err.code, code)
      if (kind === 'rate_limited') assert.equal(err.retryAfterMs, 7000)
      return true
    })
  }
})

test('409 send errors keep the hub code', async () => {
  const client = createHubClient({ hubUrl: undefined, token: TOKEN, http: fakeFetch(() => ({ status: 409, json: { code: 'pair_budget' } })) })
  await assert.rejects(client.send({}), err => err.kind === 'http' && err.code === 'pair_budget' && err.status === 409)
})

test('422 invalid keeps the field the hub names', async () => {
  const client = createHubClient({ hubUrl: undefined, token: TOKEN, http: fakeFetch(() => ({ status: 422, json: { error: 'invalid', code: 'invalid', field: 'conversation_id' } })) })
  await assert.rejects(client.send({}), err => err.code === 'invalid' && err.field === 'conversation_id' && err.status === 422)
})

test('network failure and non-JSON bodies are typed errors', async () => {
  const down = createHubClient({ hubUrl: undefined, token: TOKEN, http: { fetch: async () => { throw new Error("ECONNREFUSED") } } })
  await assert.rejects(down.poll({}), err => err.kind === 'network')
  const html = createHubClient({ hubUrl: undefined, token: TOKEN, http: fakeFetch(() => ({ status: 200, text: '<html>' })) })
  await assert.rejects(html.poll({}), err => err.kind === 'invalid_json')
})

test('pairStart and pairPoll carry no Bearer and map pending states', async () => {
  const f = fakeFetch((url, init) => {
    if (url.endsWith('/pair/start')) return { status: 200, json: { device_code: 'd', user_code: 'U-1', verification_uri: 'https://sielay.cloud/enroll?link=1', expires_in: 600, interval: 5 } }
    const n = f.calls.length
    if (n === 2) return { status: 400, json: { error: 'authorization_pending' } }
    if (n === 3) return { status: 400, json: { error: 'slow_down' } }
    return { status: 200, json: { token: 'tok', address_prefix: 'ana/laptop', hub_url: 'https://sielay.cloud' } }
  })
  const client = createHubClient({ hubUrl: undefined, token: '', http: { fetch: f.fetch } })
  const start = await client.pairStart({ slot: 'ana-laptop', hostname: 'h', client_version: '1.0.0' })
  assert.equal(start.user_code, 'U-1')
  assert.equal(f.calls[0].init.headers.authorization, undefined)
  assert.deepEqual(await client.pairPoll({ device_code: 'd' }), { status: 'authorization_pending' })
  assert.deepEqual(await client.pairPoll({ device_code: 'd' }), { status: 'slow_down' })
  const done = await client.pairPoll({ device_code: 'd' })
  assert.equal(done.status, 'ok')
  assert.equal(done.token, 'tok')
})

test('pairPoll: a hub_url outside the allow-list in the answer is refused', async () => {
  const f = fakeFetch(() => ({ status: 200, json: { token: 'tok', address_prefix: 'a/b', hub_url: 'https://evil.example' } }))
  const client = createHubClient({ hubUrl: undefined, token: '', http: { fetch: f.fetch } })
  await assert.rejects(client.pairPoll({ device_code: 'd' }), err => err.kind === 'hub_url')
})

test('pairPoll: terminal errors map to their status', async () => {
  for (const error of ['expired_token', 'access_denied']) {
    const client = createHubClient({ hubUrl: undefined, token: '', http: fakeFetch(() => ({ status: 400, json: { error } })) })
    assert.deepEqual(await client.pairPoll({ device_code: 'd' }), { status: error })
  }
})

test('pairStart: an unknown slot is a typed 404', async () => {
  const client = createHubClient({ hubUrl: undefined, token: '', http: fakeFetch(() => ({ status: 404, json: {} })) })
  await assert.rejects(client.pairStart({ slot: 'nope' }), err => err.status === 404)
})

test('409 link_paused keeps the scope the hub names, bounded; a non-string scope is dropped', async () => {
  const paused = scope => createHubClient({ hubUrl: undefined, token: TOKEN, http: fakeFetch(() => ({ status: 409, json: { code: 'link_paused', scope } })) })
  await assert.rejects(paused('device').send({}), err => err instanceof HubError && err.code === 'link_paused' && err.scope === 'device' && err.status === 409)
  await assert.rejects(paused('x'.repeat(40)).send({}), err => err.scope === 'x'.repeat(16))
  await assert.rejects(paused(7).send({}), err => err.code === 'link_paused' && err.scope === undefined)
})
