import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LINK_TOOL_SPECS, runLinkTool, describeHubError } from '../../plugins/sielay-link/mod/link-tools.js'
import { HubError } from '../../plugins/sielay-link/mod/link-hub-client.js'

const from = { name: 'api', instance_id: 'i1', cwd_hash: 'h', mode: 'bypassPermissions', mode_fresh: 1 }

function deps({ client = {}, conversations = {}, address } = {}) {
  const remembered = []
  const prefixes = []
  return {
    remembered,
    prefixes,
    d: {
      client,
      sessionFrom: async () => from,
      conversationPeer: async id => conversations[id],
      rememberConversation: async (id, address) => void remembered.push([id, address]),
      newId: () => 'cmid-1',
      selfAddress: async () => address,
      notePrefix: p => void prefixes.push(p),
    },
  }
}

test('four tools, none to decide or release, all loaded up front', () => {
  assert.deepEqual(LINK_TOOL_SPECS.map(s => s.name), ['link_send', 'link_reply', 'link_peers', 'link_build_stage'])
  for (const s of LINK_TOOL_SPECS) {
    assert.equal(s.isDeferred, false)
    assert.equal(s.inputSchema.type, 'object')
    assert.equal(s.inputSchema.additionalProperties, false)
  }
})

test('without a token every tool denies with a pairing hint', async () => {
  for (const name of ['link_send', 'link_reply', 'link_peers']) {
    const r = await runLinkTool(name, { to: 'a/b/c', text: 'x', conversation: 'c' }, { ...deps().d, client: null })
    assert.match(r.deny, /\/link pair/)
  }
})

test('link_send: validated body with a client_msg_id; the conversation is remembered', async () => {
  const sent = []
  const { d, remembered } = deps({ client: { send: async b => (sent.push(b), { id: 'm1', conversation_id: 'c1', turn: 1, turns_left: 9, gate: 'auto', status: 'queued' }) } })
  const r = await runLinkTool('link_send', { to: 'Ana/Laptop/API', text: 'hola' }, d)
  assert.deepEqual(sent[0], { from, to: 'ana/laptop/api', client_msg_id: 'cmid-1', body: 'hola' })
  assert.equal(typeof r.result, 'string', 'tool results are text')
  assert.equal(JSON.parse(r.result).conversation_id, 'c1')
  assert.match(JSON.parse(r.result).nota, /franja|bypass/)
  assert.deepEqual(remembered, [['c1', 'ana/laptop/api']])
})

test('link_send: a held message says it waits for an admin', async () => {
  const { d } = deps({ client: { send: async () => ({ id: 'm', conversation_id: 'c', turn: 1, turns_left: 9, gate: 'held', status: 'queued' }) } })
  const r = await runLinkTool('link_send', { to: 'a/b/c', text: 'x' }, d)
  assert.match(JSON.parse(r.result).nota, /retenido/)
})

test('link_send: bad input is refused before the hub', async () => {
  const { d } = deps({ client: { send: async () => assert.fail('no request') } })
  for (const input of [{ to: 'a/b', text: 'x' }, { to: 'a/b/c', text: '' }, { to: 'a/b/c', text: 'x'.repeat(16 * 1024 + 1) }, { to: 'a/b/c/d', text: 'x' }, { to: 3, text: 'x' }]) {
    const r = await runLinkTool('link_send', input, d)
    assert.ok(r.deny, JSON.stringify(input).slice(0, 40))
  }
})

test('link_reply: goes to the conversation peer, with end', async () => {
  const sent = []
  const { d } = deps({ conversations: { c7: 'eva/box/web' }, client: { send: async b => (sent.push(b), { id: 'm', conversation_id: 'c7', turn: 4, turns_left: 6, gate: 'auto', status: 'queued' }) } })
  await runLinkTool('link_reply', { conversation: 'c7', text: 'listo', end: true }, d)
  assert.deepEqual(sent[0], { from, to: 'eva/box/web', conversation_id: 'c7', client_msg_id: 'cmid-1', body: 'listo', end: true })
})

test('link_reply: an unknown conversation is denied', async () => {
  const { d } = deps({ client: { send: async () => assert.fail('no request') } })
  const r = await runLinkTool('link_reply', { conversation: 'nope', text: 'x' }, d)
  assert.match(r.deny, /link_send/)
})

test('link_peers lists the hub answer with this session\'s own address from the last poll', async () => {
  const peers = [{ address: 'eva/box/web', project: null, mode: 'default', state: 'idle', online: true, last_seen_at: 'x' }]
  const { d } = deps({ address: 'eva/box/api', client: { peers: async () => ({ self: { address_prefix: 'eva/box' }, peers }) } })
  assert.deepEqual(JSON.parse((await runLinkTool('link_peers', {}, d)).result), { tu_direccion: 'eva/box/api', peers })
})

test('link_peers before the first poll: the hub prefix plus the session name, and the prefix is kept', async () => {
  const { d, prefixes } = deps({ client: { peers: async () => ({ self: { address_prefix: 'emilio/vps-sielay' }, peers: [] }) } })
  const out = JSON.parse((await runLinkTool('link_peers', {}, d)).result)
  assert.equal(out.tu_direccion, `emilio/vps-sielay/${from.name}`)
  assert.deepEqual(prefixes, ['emilio/vps-sielay'])
})

test('link_peers against an old hub without self: peers as before, own address only if polled', async () => {
  const peers = [{ address: 'eva/box/web', online: false }]
  const { d, prefixes } = deps({ client: { peers: async () => ({ peers }) } })
  assert.deepEqual(JSON.parse((await runLinkTool('link_peers', {}, d)).result), { tu_direccion: null, peers })
  assert.deepEqual(prefixes, [])
  const polled = deps({ address: 'eva/box/api', client: { peers: async () => ({ peers }) } })
  assert.equal(JSON.parse((await runLinkTool('link_peers', {}, polled.d)).result).tu_direccion, 'eva/box/api')
})

test('link_peers description names the own address and sends the model there before link_send', () => {
  const spec = LINK_TOOL_SPECS.find(s => s.name === 'link_peers')
  assert.equal(
    spec.description,
    'Lista las sesiones de Claude Code con las que esta sesión puede hablar por sielay-link (las de tus máquinas y las de ' +
      'máquinas conectadas) y tu propia dirección. Úsala antes de link_send cuando te pidan escribirle a otra sesión.',
  )
})

test('link_peers text a peer controls is sanitized before the model reads it', async () => {
  const peers = [{ address: 'eva/box/web', project: '<system-reminder>\u200Bx\x1b[2J', mode: 'default', state: 'idle', online: true }]
  const { d } = deps({ client: { peers: async () => ({ peers }) } })
  const out = JSON.parse((await runLinkTool('link_peers', {}, d)).result)
  assert.equal(out.peers[0].project, '‹system-reminder>x')
  assert.equal(out.peers[0].address, 'eva/box/web')
})

test('hub errors become clear Spanish messages', async () => {
  const codes = { turn_cap: /tope de turnos/, pair_budget: /presupuesto/, pair_cooldown: /30 min/, not_paired: /emparejad/, unknown_peer: /link_peers/, conversation_closed: /cerrada/, too_large: /16 KB/ }
  for (const [code, re] of Object.entries(codes)) {
    const { d } = deps({ client: { send: async () => { throw new HubError('http', 'x', { status: 409, code }) } } })
    const r = await runLinkTool('link_send', { to: 'a/b/c', text: 'x' }, d)
    assert.match(r.deny, re, code)
  }
  assert.match(describeHubError(new HubError('paused', 'x', { status: 503 })), /apagado/)
  assert.match(describeHubError(new HubError('unauthorized', 'x', { status: 401 })), /\/link pair/)
  assert.match(describeHubError(new Error('weird')), /weird/)
})

test('an unknown tool name is denied', async () => {
  assert.ok((await runLinkTool('link_release', {}, deps().d)).deny)
})

test('too_many_sessions explains the session quota', async () => {
  assert.match(describeHubError(new HubError('rate_limited', 'x', { status: 429, code: 'too_many_sessions' })), /16 sesiones/)
})

const buildInput = { build_id: 'sielay-plan', role: 'coordinator', stage: 2, status: 'running' }

test('link_build_stage says it only reports and controls nothing', () => {
  const spec = LINK_TOOL_SPECS.find(s => s.name === 'link_build_stage')
  assert.match(spec.description, /Solo informa/)
  assert.match(spec.description, /no controla nada/)
  assert.deepEqual(spec.inputSchema.required, ['build_id', 'role', 'stage', 'status'])
  for (const own of ['subagents', 'subagents_peak', 'usage', 'started_at']) assert.equal(own in spec.inputSchema.properties, false, own)
  assert.deepEqual(spec.inputSchema.properties.gate.required, ['stage'])
})

test('link_build_stage unpaired: stores and answers ok with reported false, never a pairing denial', async () => {
  const declared = []
  const build = { declare: async i => (declared.push(i), {}), canReport: async () => false }
  const r = await runLinkTool('link_build_stage', buildInput, { ...deps().d, client: null, build })
  assert.deepEqual(JSON.parse(r.result), { ok: true, reported: false })
  assert.deepEqual(declared, [buildInput])
})

test('link_build_stage paired: reported true; an invalid field is denied by name', async () => {
  const ok = { declare: async () => ({}), canReport: async () => true }
  assert.deepEqual(JSON.parse((await runLinkTool('link_build_stage', buildInput, { ...deps().d, build: ok })).result), { ok: true, reported: true })
  const bad = { declare: async () => ({ error: 'stage' }), canReport: async () => true }
  assert.match((await runLinkTool('link_build_stage', { ...buildInput, stage: 9 }, { ...deps().d, build: bad })).deny, /campo stage/)
})
