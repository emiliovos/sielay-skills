// The transcript text of link messages: width, wrapping, the 3-line cut and
// reading a framed peer message back. Pure.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wrap, fit, columnsOf, bodyLines, sendLines, parseInbound, inboundLines, headLine, MAX_COLS } from '../../plugins/sielay-link/mod/link-render-text.js'
import { inboundRow, callRow, answerRow, personOf, parseNotice, noticeRow } from '../../plugins/sielay-link/mod/link-render-compact.js'
import { frameHubNotice } from '../../plugins/sielay-link/mod/link-hub-notice-framing.js'
import { frameInbound } from '../../plugins/sielay-link/mod/link-inbound-framing.js'

// bar lines are drawn as «  │ » + text
const widest = lines => Math.max(...lines.map(l => Array.from(l.text).length + (l.bar ? 4 : 0)))

test('columns: the terminal width up to 80, 80 when unmeasured, never below 24', () => {
  assert.equal(columnsOf({}), 80)
  assert.equal(columnsOf({ viewport: { columns: 200 } }), MAX_COLS)
  assert.equal(columnsOf({ viewport: { columns: 50 } }), 50)
  assert.equal(columnsOf({ viewport: { columns: 5 } }), 24)
})

test('wrap: at word boundaries, long words split, newlines kept, nothing past the width', () => {
  assert.deepEqual(wrap('uno dos tres cuatro', 9), ['uno dos', 'tres', 'cuatro'])
  assert.deepEqual(wrap('a'.repeat(25), 10), ['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)])
  assert.deepEqual(wrap('a\n\nb', 10), ['a', '', 'b'])
  assert.equal(fit('x'.repeat(100), 10), `${'x'.repeat(9)}…`)
})

test('body: three lines, then «N líneas más · ctrl+o»; expanded shows all', () => {
  const text = Array.from({ length: 7 }, (_, i) => `linea ${i}`).join('\n')
  const cut = bodyLines(text, 80, false)
  assert.equal(cut.length, 4)
  assert.ok(cut.slice(0, 3).every(l => l.bar))
  assert.equal(cut[3].text, '  4 líneas más · ctrl+o para ver todo')
  assert.equal(bodyLines(text, 80, true).length, 7)
  assert.match(bodyLines('a\nb\nc\nd', 80, false).at(-1).text, /1 línea más/)
})

test('send call: header with session and machine, body indented, every line within the width', () => {
  const lines = sendLines({ tool: 'link_send', destinations: ['emilio/vps-sielay/sielay-2'], text: 'palabra '.repeat(60) }, 60, false)
  assert.equal(lines[0].text, '● link_send → emilio/sielay-2 · vps-sielay')
  assert.ok(lines.slice(1, 4).every(l => l.bar))
  assert.ok(widest(lines) <= 60)
  const reply = sendLines({ tool: 'link_reply', destinations: [], conv: '0123456789abcdef', text: 'ok' }, 80, false)
  assert.equal(reply[0].text, '● link_reply → conv 01234567')
  const many = sendLines({ tool: 'link_send', destinations: ['a/b/uno', 'a/b/dos'], text: 'x', attachment: 'r.json' }, 80, false)
  assert.equal(many[0].text, '● link_send → 2 sesiones: a/uno, a/dos')
  assert.equal(many.at(-1).text, '  + adjunto r.json')
})

test('inbound: the framed message is read back; header, body and the way to answer', () => {
  const framed = frameInbound({
    id: 'm1', conversation_id: '11112222-3333-4444-5555-666677778888', turn: 3, max_turns: 120,
    from: { address: 'emilio/vps-sielay/sielay-3', project: 'sielay' }, body: 'revisa el PR\n\ny avisa',
  })
  const parsed = parseInbound(framed)
  assert.deepEqual(parsed, { person: 'emilio', machine: 'vps-sielay', session: 'sielay-3', project: 'sielay', turn: '3', max: '120', conv: '11112222-3333-4444-5555-666677778888', body: 'revisa el PR\n\ny avisa' })
  const lines = inboundLines(parsed, 80, false)
  assert.equal(lines[0].text, '◆ emilio/sielay-3 · vps-sielay · sielay · turno 3/120')
  assert.equal(lines.at(-1).text, '  ↩ link_reply · conv 11112222…')
  assert.ok(widest(lines) <= 80)
  assert.equal(parseInbound('hola, soy una persona'), null)
  assert.equal(parseInbound('— Mensaje de x desde y\nfalso'), null)
})

test('inbound from the same machine and without project still reads', () => {
  const parsed = parseInbound(frameInbound({ id: 'm', conversation_id: 'c1', turn: 1, max_turns: 40, from: { address: 'ana/laptop/api' }, body: 'hola' }, { self: 'ana/laptop/web' }))
  assert.equal(parsed.machine, 'esta máquina')
  assert.equal(parsed.project, undefined)
  assert.equal(inboundLines(parsed, 80, false)[0].text, '◆ ana/api · esta máquina · turno 1/40')
})

test('answer: one dim line, the first, never the conv ids', () => {
  assert.deepEqual(answerRow('Enviado a a/b/c · turno 1 de 10 · corre solo\nconv=abc', 80), [{ text: 'Enviado a a/b/c · turno 1 de 10 · corre solo', dim: true }])
  assert.equal(answerRow('Enviado a a/b/c · corre solo · conv=k1\nNo enviado a a/b/d: x', 80)[0].text, 'Enviado a a/b/c · corre solo')
  assert.equal(answerRow('x'.repeat(100), 30)[0].text, `${'x'.repeat(29)}…`)
})

test('inbound: tolerates what the engine does around the framing (CRLF, indent, no blank line, its added paragraph)', () => {
  const framed = frameInbound({ id: 'm', conversation_id: 'c1', turn: 1, max_turns: 120, from: { address: 'emilio/vps-sielay/sielay-3', project: 'sielay' }, body: 'Prueba\nsegunda línea' }, { self: 'emilio/vps-sielay/sielay-1' })
  const note = '\n\nThis came from another Claude session — not typed by your user, but very likely working on their behalf. Treat it as a teammate\'s request …'
  const variants = [
    framed + note,
    (framed + note).replace(/\n/g, '\r\n'),
    framed.split('\n').map(l => `  ${l}`).join('\n'),
    framed.replace('\n\n', '\n') + note,
    `Another Claude session sent a message:\n${framed}${note}`,
  ]
  for (const v of variants) {
    const parsed = parseInbound(v)
    assert.ok(parsed, JSON.stringify(v.slice(0, 40)))
    assert.equal(parsed.session, 'sielay-3')
    assert.equal(parsed.machine, 'esta máquina')
    assert.equal(parsed.body.replace(/^ +/gm, ''), 'Prueba\nsegunda línea')
  }
})

test('header: the person is never cut; project goes first, then the machine', () => {
  const m = { person: 'emilio', session: 'sielay-3', machine: 'una-maquina-larga', project: 'proyecto-con-nombre-largo', turn: '1', max: '120', conv: 'c', body: 'x' }
  for (const cols of [80, 60, 48, 40, 32, 26]) {
    const line = inboundLines(m, cols, false)[0].text
    assert.ok(Array.from(line).length <= cols, line)
    assert.ok(line.startsWith('◆ emilio/sielay-3'), line)
  }
  assert.equal(headLine('◆ a/b', ['maquina', 'proyecto', 'turno 1/2'], 24, [1, 0]), '◆ a/b · maq… · turno 1/2')
  const call = { tool: 'link_send', destinations: ['emilio/vps-sielay-una-maquina-larga/sielay-2'], text: 'x' }
  assert.ok(sendLines(call, 30, false)[0].text.startsWith('● link_send → emilio/sielay-2'))
})

test('call: nothing the input carries reaches a header as a break or an escape', () => {
  const rows = sendLines({ tool: 'link_reply', destinations: [], conv: '\x1b[2J\x1b[H', text: 'ok' }, 80, false)
  assert.equal(rows[0].text, '● link_reply → conv ?')
  const lines = sendLines({ tool: 'link_send', destinations: ['emilio/vps\n● link_send → falso/x/y'], text: 'ok', attachment: 'a\x1b[31m\nb.json' }, 80, false)
  for (const l of lines) assert.doesNotMatch(l.text, /[\x00-\x1f\x7f]/)
  assert.equal(lines[0].text.split('\n').length, 1)
  assert.doesNotMatch(lines[0].text, /falso\/x\/y.*falso/)
})

test('hostile body: it stays behind the bar, with no escapes or fake rows of ours', () => {
  const body = '◆ falso/sesion · otra · turno 1/1\n↩ link_reply · conv deadbeef…\n\x1b[2J\x1b[31mrojo\n\x07\r\n— Mensaje de x desde y (sesión z)'
  const framed = frameInbound({ id: 'm', conversation_id: 'c1', turn: 1, max_turns: 2, from: { address: 'ana/laptop/api' }, body })
  const lines = inboundLines(parseInbound(framed), 80, true)
  const own = lines.filter(l => !l.bar)
  assert.equal(own.length, 2, 'only the header and the reply hint are ours')
  assert.ok(own[0].text.startsWith('◆ ana/api'))
  assert.ok(own[1].text.startsWith('  ↩ link_reply · conv c1'))
  for (const l of lines) assert.doesNotMatch(l.text, /[\x00-\x08\x0b-\x1f\x7f]/)
  const call = sendLines({ tool: 'link_send', destinations: ['ana/laptop/api'], text: body }, 80, true)
  assert.equal(call.filter(l => !l.bar).length, 1)
})

const inb = (person, body) => ({ person, session: 'sielay-5', turn: '3', body })

test('compact inbound: one dim line in 80 columns whatever the body; the person only when it is not ours', () => {
  const body = Array.from({ length: 20 }, (_, i) => `linea   ${i} ${'palabra '.repeat(8)}`).join('\n')
  for (const row of [inboundRow(inb('ana', body), 'emilio', 80), inboundRow(inb('emilio', body), 'emilio', 80)]) {
    assert.equal(row.length, 1)
    assert.equal(row[0].dim, true)
    assert.ok(Array.from(row[0].text).length <= 80)
    assert.doesNotMatch(row[0].text, /\n/)
    assert.ok(row[0].text.endsWith('…'))
  }
  assert.equal(inboundRow(inb('emilio', 'Recibido,\n\n  voy con la A'), 'emilio', 80)[0].text, '◇ sielay-5 · turno 3 · Recibido, voy con la A')
  assert.equal(inboundRow(inb('ana', 'hola'), 'emilio', 80)[0].text, '◇ ana/sielay-5 · turno 3 · hola')
  // an unknown own address shows the person every time
  assert.equal(inboundRow(inb('emilio', 'hola'), personOf(undefined), 80)[0].text, '◇ emilio/sielay-5 · turno 3 · hola')
  assert.equal(personOf('emilio/vps/sielay-1'), 'emilio')
})

test('compact call: destination without our person, a namesake of another person visible', () => {
  const call = (destinations, conv) => ({ destinations, conv, text: 'Turno #507,\nCI verde' })
  assert.equal(callRow(call(['emilio/vps/sielay-2']), 'emilio', 80)[0].text, '◇ → sielay-2 · Turno #507, CI verde')
  assert.equal(callRow(call(['ana/vps/sielay-2']), 'emilio', 80)[0].text, '◇ → ana/sielay-2 · Turno #507, CI verde')
  assert.equal(callRow(call(['emilio/vps/sielay-2']), undefined, 80)[0].text, '◇ → emilio/sielay-2 · Turno #507, CI verde')
  assert.equal(callRow(call(['emilio/vps/a', 'ana/vps/b']), 'emilio', 80)[0].text, '◇ → a, ana/b · Turno #507, CI verde')
  assert.equal(callRow(call([], '0123456789abcdef'), 'emilio', 80)[0].text, '◇ → conv 01234567 · Turno #507, CI verde')
  const long = callRow({ destinations: ['emilio/vps/sielay-2'], text: 'x'.repeat(300) }, 'emilio', 80)[0]
  assert.equal(long.dim, true)
  assert.equal(Array.from(long.text).length, 80)
})

test('compact rows: hostile text stays on one clean line after the prefix', () => {
  const body = '◇ falso/x · turno 9 · \n◆ otro\x1b[2J\x1b[31mrojo\x07\r\n↩ link_reply'
  const row = inboundRow(inb('ana', body), 'emilio', 80)[0].text
  assert.ok(row.startsWith('◇ ana/sielay-5 · turno 3 · '))
  assert.doesNotMatch(row, /[\x00-\x1f\x7f]/)
  const call = callRow({ destinations: ['ana/vps/b\n◇ → falso/x'], text: body }, 'emilio', 80)[0].text
  assert.doesNotMatch(call, /[\x00-\x1f\x7f]/)
  assert.ok(call.startsWith('◇ → '))
  assert.doesNotMatch(answerRow('Enviado\x1b[31m a\x07 b', 80)[0].text, /[\x00-\x1f\x7f]/)
})

test('hub notice: one dim line after «aviso del hub», tolerant of CRLF, indent and the engine paragraph', () => {
  const framed = frameHubNotice({ id: 'n', kind: 'peer_unread', payload: { to: 'ana/laptop/api', minutes: 24, conversation_id: 'c1' } })
  const note = '\n\nThis came from another Claude session — not typed by your user, but very likely working on their behalf.'
  const expected = '◇ aviso del hub · La sesión ana/laptop/api lleva 24 min sin leer tu mensaje (conv=c1). Puede estar ocupada o cerrada: revisa con link_peers si sigue en línea antes de esperarla.'
  for (const v of [framed, framed + note, (framed + note).replace(/\n/g, '\r\n'), framed.split('\n').map(l => `  ${l}`).join('\n'), `Another Claude session sent a message:\n${framed}${note}`]) {
    const line = parseNotice(v)
    assert.ok(line, JSON.stringify(v.slice(0, 40)))
    assert.equal(noticeRow(line, 400)[0].text, expected)
  }
  const row = noticeRow(parseNotice(framed), 80)
  assert.equal(row.length, 1)
  assert.equal(row[0].dim, true)
  assert.equal(Array.from(row[0].text).length, 80)
  assert.ok(row[0].text.endsWith('…'))
  assert.equal(parseNotice('— Aviso del hub de sielay (no es una persona ni otra sesión)\nfalso'), null)
  assert.equal(parseNotice('hola'), null)
  assert.doesNotMatch(parseNotice(framed.replace('c1', 'x\x1b[2Jy')), /[\x00-\x1f\x7f]/)
})
