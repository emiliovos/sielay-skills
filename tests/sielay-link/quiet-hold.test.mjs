import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createInboundHandler } from '../../plugins/sielay-link/mod/link-inbound-handler.js'
import { DEFAULT_QUIET_MAX_MIN, isQuiet, parseQuietRule } from '../../plugins/sielay-link/mod/link-quiet-hold.js'

const MIN = 60_000

function memStore() {
  const m = new Map()
  return { m, get: async k => structuredClone(m.get(k)), set: async (k, v) => void m.set(k, structuredClone(v)) }
}

const message = (id, body, extra = {}) => ({ id, conversation_id: 'c', turn: 1, max_turns: 10, from: { address: 'a/b/c' }, body, run: 1, gate: 'auto', ...extra })

/** A handler over a fake session: `busy`, `clock` and `mode` are the test's to move. */
function session({ store = memStore(), spec = 'AVANCE', fail = () => false } = {}) {
  const s = { store, injected: [], busy: false, clock: 0, mode: { mode: 'bypassPermissions', fresh: true } }
  s.h = createInboundHandler({
    store,
    adapter: { inject: async text => { if (fail(text)) throw new Error('socket down'); s.injected.push(text) } },
    readMode: async () => s.mode,
    onStrip: async () => {},
    quietRule: async () => parseQuietRule(spec),
    isBusy: () => s.busy,
    now: () => s.clock,
  })
  s.poll = (...messages) => s.h.handlePoll('inst', { messages })
  s.has = text => s.injected.some(i => i.includes(text))
  return s
}

test('the rule: only the listed headers wait, and their FINAL form always wakes', () => {
  const rule = parseQuietRule('AVANCE')
  assert.equal(isQuiet('AVANCE · PR #12 mergeado', rule), true)
  assert.equal(isQuiet('\n  AVANCE\nresto', rule), true)
  assert.equal(isQuiet('AVANCE FINAL · encargo terminado', rule), false)
  assert.equal(isQuiet('AVANCE  FINAL', rule), false)
  assert.equal(isQuiet('AVANCE FINALIZADO el PR', rule), true)
  assert.equal(isQuiet('AVANCES del día', rule), false)
  for (const body of ['ALERTA · CI rojo', 'DUDA #3 · ¿sigo?', 'DECISIÓN #9 · sí', 'sin encabezado, AVANCE', '']) assert.equal(isQuiet(body, rule), false, body)
  assert.equal(isQuiet('AVANCE', null), false)
  assert.equal(isQuiet(undefined, rule), false)
})

test('the rule: off without headers, the limit defaults unless it is a positive number', () => {
  assert.equal(parseQuietRule(''), null)
  assert.equal(parseQuietRule(undefined), null)
  assert.equal(parseQuietRule('AVANCE').maxMs, DEFAULT_QUIET_MAX_MIN * MIN)
  assert.equal(parseQuietRule('AVANCE', '3').maxMs, 3 * MIN)
  for (const bad of ['0', '-1', 'x']) assert.equal(parseQuietRule('AVANCE', bad).maxMs, DEFAULT_QUIET_MAX_MIN * MIN)
})

test('a quiet message to an idle session is acked without opening a turn, and goes in at the next one', async () => {
  const s = session()
  assert.deepEqual(await s.poll(message('m1', 'AVANCE uno')), [{ id: 'm1', outcome: 'injected' }])
  assert.equal(s.injected.length, 0)
  await s.h.onTurnStart()
  assert.ok(s.has('AVANCE uno'))
  await s.h.onTurnStart()
  assert.equal(s.injected.length, 1, 'once')
})

test('nothing waits past the limit, and the limit brings everything held', async () => {
  const s = session()
  await s.poll(message('m1', 'AVANCE uno'))
  s.clock = 5 * MIN
  await s.poll(message('m2', 'AVANCE dos'))
  s.clock = 10 * MIN - 1
  await s.poll()
  assert.equal(s.injected.length, 0)
  s.clock = 10 * MIN
  await s.poll()
  assert.ok(s.has('AVANCE uno') && s.has('AVANCE dos'))
  assert.ok(s.injected.findIndex(i => i.includes('uno')) < s.injected.findIndex(i => i.includes('dos')), 'oldest first')
})

for (const body of ['ALERTA · CI rojo', 'DUDA #3 · ¿sigo?', 'DECISIÓN #9 · sí', 'AVANCE FINAL · listo', 'respuesta sin encabezado']) {
  test(`«${body}» wakes an idle session at once, behind what was held`, async () => {
    const s = session()
    await s.poll(message('m1', 'AVANCE previo'))
    await s.poll(message('m2', body))
    assert.equal(s.injected.length, 2)
    assert.ok(s.injected[0].includes('AVANCE previo'))
    assert.ok(s.injected[1].includes(body.split(' ').pop()))
  })
}

test('a session in a turn takes a quiet message right away: it costs no turn of its own', async () => {
  const s = session()
  s.busy = true
  await s.poll(message('m1', 'AVANCE uno'))
  assert.ok(s.has('AVANCE uno'))
})

test('a poll inside a turn delivers what a missed turn start left held', async () => {
  const s = session()
  await s.poll(message('m1', 'AVANCE uno'))
  s.busy = true
  await s.poll()
  assert.ok(s.has('AVANCE uno'))
})

test('without the variable nothing is held', async () => {
  const s = session({ spec: '' })
  await s.poll(message('m1', 'AVANCE uno'))
  assert.ok(s.has('AVANCE uno'))
})

test('a held message survives a reload and is not held twice when the hub redelivers it', async () => {
  const first = session()
  await first.poll(message('m1', 'AVANCE uno'))
  const second = session({ store: first.store })
  assert.deepEqual(await second.poll(message('m1', 'AVANCE uno')), [{ id: 'm1', outcome: 'injected' }])
  await second.h.onTurnStart()
  assert.equal(second.injected.length, 1)
})

test('the run gate is read again when it goes in: a mode that changed keeps it waiting', async () => {
  const s = session()
  await s.poll(message('m1', 'AVANCE uno'))
  s.mode = { mode: 'default', fresh: true }
  await s.h.onTurnStart()
  s.clock = 20 * MIN
  await s.poll()
  assert.equal(s.injected.length, 0)
  s.mode = { mode: 'bypassPermissions', fresh: true }
  await s.h.onTurnStart()
  assert.ok(s.has('AVANCE uno'))
})

test('a message the gate does not run goes to the strip, not to the held list', async () => {
  const s = session()
  s.mode = { mode: 'default', fresh: true }
  assert.deepEqual(await s.poll(message('m1', 'AVANCE uno')), [{ id: 'm1', outcome: 'shown' }])
  assert.equal(s.h.currentStrip().length, 1)
  assert.equal(s.store.m.get('held.inst'), undefined)
})

test('a failed delivery keeps the message for the next try', async () => {
  let down = true
  const s = session({ fail: () => down })
  await s.poll(message('m1', 'AVANCE uno'))
  await s.h.onTurnStart()
  assert.equal(s.injected.length, 0)
  down = false
  await s.h.onTurnStart()
  assert.equal(s.injected.length, 1)
})

test('a poll and a turn start at the same time deliver a held message once', async () => {
  const s = session()
  await s.poll(message('m1', 'AVANCE uno'))
  s.busy = true
  await Promise.all([s.h.onTurnStart(), s.poll(), s.h.onTurnStart()])
  assert.equal(s.injected.length, 1)
})
