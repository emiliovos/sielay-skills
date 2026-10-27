import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createThreads, recordInbound, recordOutbound } from '../../plugins/sielay-link/mod/link-threads.js'
import { frameThread, parseThread } from '../../plugins/sielay-link/mod/link-thread-text.js'
import { inboundThreadRows, outboundTurnRows, outboundAnswerRows, threadCardLines } from '../../plugins/sielay-link/mod/link-thread-rows.js'

const SELF = 'emilio/vps-sielay/sielay-6'
const at = (h, m) => new Date(2026, 9, 26, h, m).getTime()

/** A session that lives through the two crossed threads of the design demo. */
function session() {
  const h = { reg: undefined, now: at(19, 42) }
  const threads = createThreads({ get: async () => structuredClone(h.reg), set: async v => void (h.reg = structuredClone(v)), now: () => h.now })
  const ctx = () => ({ self: SELF, registry: h.reg })
  const msg = (conv, seq, from, body, project, conversation) => ({
    id: `${conv}-${seq}`, conversation_id: conv, seq, turn: seq, max_turns: 40, from: { address: from, project }, body,
    sent_at: new Date(h.now).toISOString(), conversation,
  })
  /** An incoming turn: registered when it enters, then drawn the way link_read brings it. */
  const inbound = async (when, conv, seq, from, body, project, conversation, cols = 80) => {
    h.now = when
    const d = msg(conv, seq, from, body, project, conversation)
    await recordInbound(threads, d)
    return inboundThreadRows(parseThread(frameThread([d], { self: SELF, registry: h.reg })), ctx(), cols).map(r => r.text)
  }
  const outbound = async (when, id, conv, to, turn, text, extra = {}, cols = 80) => {
    h.now = when
    const mark = await recordOutbound(threads, { toolUseId: id, conv, to, turn, ...extra }, SELF)
    const call = { destinations: [to], text }
    return [...outboundTurnRows(call, mark, ctx(), cols), ...(outboundAnswerRows(mark, ctx(), cols) ?? [])].map(r => r.text)
  }
  return { h, threads, ctx, inbound, outbound }
}

const OP = 'emilio/vps-sielay/operacion'
const S3 = 'emilio/pve2/sielay-3'

async function demo(cols = 80) {
  const s = session()
  const rows = []
  rows.push(...await s.inbound(at(19, 42), 'c1', 1, OP, 'Arranca el build del formato A; demo de 2 hilos antes del Frame.', 'sielay', undefined, cols))
  rows.push(...await s.inbound(at(19, 44), 'c2', 1, S3, '¿Vas a tocar link-render-text.js? Yo tengo un cambio chico ahí.', 'sielay-skills', undefined, cols))
  rows.push(...await s.outbound(at(19, 45), 'tu1', 'c1', OP, 2, 'Demo lista; va el Frame con 6 criterios', {}, cols))
  rows.push(...await s.outbound(at(19, 46), 'tu2', 'c2', S3, 2, 'Sí, es mío en este build; no lo toques', {}, cols))
  rows.push(...await s.inbound(at(19, 47), 'c2', 3, S3, 'Va', undefined, { status: 'closed', closed_reason: 'end', closed_by: S3 }, cols))
  rows.push(...await s.inbound(at(19, 52), 'c1', 3, OP, 'Sí al Frame', 'sielay', undefined, cols))
  rows.push(...await s.outbound(at(19, 53), 'tu3', 'c1', OP, 4, 'Cierro', { end: true }, cols))
  return { s, rows }
}

test('the two crossed threads of the design: header on the first turn, numbers only once they cross, closures with the number', async () => {
  const { rows } = await demo()
  assert.deepEqual(rows, [
    '① operacion ⇄ sielay-6 · esta máquina · proyecto sielay',
    '   19:42  operacion → sielay-6 · Arranca el build del formato A; demo de 2 hilo…',
    '② sielay-3 ⇄ sielay-6 · pve2 · proyecto sielay-skills',
    '②  19:44  sielay-3 → sielay-6 · ¿Vas a tocar link-render-text.js? Yo tengo un c…',
    '①  19:45  sielay-6 → operacion · Demo lista; va el Frame con 6 criterios',
    '②  19:46  sielay-6 → sielay-3 · Sí, es mío en este build; no lo toques',
    '②  19:47  sielay-3 → sielay-6 · Va',
    '②  ✓ cerrado por sielay-3 · 19:47 · 3 turnos',
    '①  19:52  operacion → sielay-6 · Sí al Frame',
    '①  19:53  sielay-6 → operacion · Cierro',
    '①  ✓ cerrado por sielay-6 · 19:53 · 4 turnos',
  ])
})

test('a lone thread has no number, its header only on the first turn, and it ends with its closure', async () => {
  const s = session()
  assert.deepEqual(await s.inbound(at(19, 42), 'c1', 1, OP, 'uno', 'sielay'), ['① operacion ⇄ sielay-6 · esta máquina · proyecto sielay', '   19:42  operacion → sielay-6 · uno'])
  assert.deepEqual(await s.inbound(at(19, 43), 'c1', 2, OP, 'dos'), ['   19:43  operacion → sielay-6 · dos'])
  assert.deepEqual(await s.outbound(at(19, 44), 'tu', 'c1', OP, 3, 'tres', { end: true }), ['   19:44  sielay-6 → operacion · tres', '   ✓ cerrado por sielay-6 · 19:44 · 3 turnos'])
})

test('drawing a row again after another thread closed does not change the rows already fixed', async () => {
  const { s } = await demo()
  const before = JSON.stringify(s.h.reg.marks.tu1)
  const draw = () => outboundTurnRows({ destinations: [OP], text: 'Demo lista; va el Frame con 6 criterios' }, s.h.reg.marks.tu1, s.ctx(), 80).map(r => r.text)
  const rows = draw()
  // thread ② is closed in the registry by now; ① stays numbered, and so does a new turn of a later thread
  await s.inbound(at(20, 30), 'c3', 1, OP, 'otro tema')
  assert.deepEqual(draw(), rows)
  assert.equal(JSON.stringify(s.h.reg.marks.tu1), before)
  assert.deepEqual(rows, ['①  19:45  sielay-6 → operacion · Demo lista; va el Frame con 6 criterios'])
  // the inbound turn of ② also reads back from its mark
  const read = inboundThreadRows(parseThread(frameThread([{ id: 'x', conversation_id: 'c2', seq: 1, turn: 1, max_turns: 40, from: { address: S3 }, body: 'x' }], { self: SELF, registry: s.h.reg })), s.ctx(), 80)
  assert.equal(read[0].text.startsWith('② sielay-3 ⇄ sielay-6'), true)
  assert.equal(read[1].text.startsWith('②  19:44  sielay-3 → sielay-6'), true)
})

test('a turn with no mark is an indented row without number, the hour of the text when it has one', () => {
  const block = parseThread(frameThread([{ id: 'x', conversation_id: 'c9', turn: 2, max_turns: 40, from: { address: OP }, body: 'hola\nque tal', sent_at: new Date(at(8, 5)).toISOString() }], { self: SELF }))
  assert.deepEqual(inboundThreadRows(block, { self: SELF }, 80).map(r => r.text), ['   08:05  operacion → sielay-6 · hola que tal'])
  const nohour = parseThread(frameThread([{ id: 'x', conversation_id: 'c9', turn: 2, max_turns: 40, from: { address: OP }, body: 'hola' }], { self: SELF }))
  assert.deepEqual(inboundThreadRows(nohour, { self: SELF }, 80).map(r => r.text), ['   operacion → sielay-6 · hola'])
  assert.deepEqual(outboundTurnRows({ destinations: [OP], text: 'va' }, undefined, { self: SELF }, 80).map(r => r.text), ['   sielay-6 → operacion · va'])
})

test('the state of a message we sent: waits in the strip, held by an admin, refused because the thread was closed', async () => {
  const s = session()
  assert.deepEqual((await s.outbound(at(19, 42), 'a', 'c1', S3, 1, 'va', { gate: 'strip' })).slice(1), ['   19:42  sielay-6 → sielay-3 · va', '   ⏸ en la franja de sielay-3'])
  assert.deepEqual((await s.outbound(at(19, 43), 'b', 'c2', S3, 1, 'va', { gate: 'held' })).slice(-1), ['②  ⧗ retenido por un admin'])
  const gone = await s.outbound(at(19, 44), 'c', 'c3', S3, undefined, 'va', { closed: { by: undefined, reason: 'admin' } })
  assert.equal(gone.at(-1), '③  ✕ cerrado por un admin')
  const idle = await s.outbound(at(19, 45), 'd', 'c4', S3, undefined, 'va', { closed: { by: undefined, reason: 'idle' } })
  assert.equal(idle.at(-1), '③  ✕ cerrado por inactividad', 'a refused send closes its thread at once, so its number is free again')
  const again = await s.outbound(at(19, 46), 'e', 'c3', S3, undefined, 'va', { closed: { by: undefined, reason: 'admin' } })
  assert.equal(again.length, 1, 'the closure of a thread is drawn once; the second refusal leaves the short answer to the caller')
  assert.equal(outboundAnswerRows(s.h.reg.marks.e, s.ctx(), 80), null)
  const cap = await s.inbound(at(19, 47), 'c5', 7, S3, 'tope', undefined, { status: 'capped', closed_reason: null, closed_by: null })
  assert.equal(cap.at(-1).trim().endsWith('⊘ tope de turnos'), true)
})

test('no line is wider than the terminal, from 24 to 80 columns, whatever the names and the text', async () => {
  for (const cols of [24, 30, 40, 60, 80]) {
    const { rows } = await demo(cols)
    for (const row of rows) assert.ok(Array.from(row).length <= cols, `${cols} cols: «${row}» is ${Array.from(row).length}`)
  }
  const s = session()
  const long = 'proyecto-con-un-nombre-muy-largo-que-no-cabe'
  const rows = await s.inbound(at(19, 42), 'c1', 1, 'emilio/una-maquina-con-nombre-largo/una-sesion-larguisima', 'x'.repeat(300), long, undefined, 24)
  for (const row of rows) assert.ok(Array.from(row).length <= 24, `«${row}»`)
  assert.ok(rows[0].startsWith('①'), 'the number is never what gets cut')
  const card = threadCardLines(parseThread(frameThread([{ id: 'x', conversation_id: 'c1', turn: 1, max_turns: 40, from: { address: OP, project: long }, body: 'palabra '.repeat(40) }], { self: SELF, registry: s.h.reg })), 24)
  for (const line of card) assert.ok(Array.from(line.text).length <= 24, `«${line.text}»`)
})

test('ctrl+o: the card of a conversation with the new header, the body behind the bar and how to answer', async () => {
  const s = session()
  const d = { id: 'x', conversation_id: '3f2a91c0-aaaa', seq: 1, turn: 1, max_turns: 40, from: { address: OP, project: 'sielay' }, body: 'Arranca el build.\nSegunda línea.', sent_at: new Date(at(19, 42)).toISOString() }
  await recordInbound(s.threads, d)
  const lines = threadCardLines(parseThread(frameThread([d], { self: SELF, registry: s.h.reg })), 80)
  assert.deepEqual(lines.map(l => l.text), [
    '① operacion ⇄ sielay-6 · esta máquina · proyecto sielay',
    '   conv 3f2a91c0 · verificado por el hub · otra sesión, no la persona',
    '',
    '   19:42  operacion → sielay-6 · turno 1 de 40',
    'Arranca el build.', 'Segunda línea.',
    '',
    '   ↩ responde con link_reply · conv 3f2a91c0…',
  ])
  assert.deepEqual(lines.filter(l => l.bar).length, 2)
})
