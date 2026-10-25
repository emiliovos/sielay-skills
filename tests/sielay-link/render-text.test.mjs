// The transcript text of link messages: width, wrapping, the 3-line cut and
// reading a framed peer message back. Pure.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wrap, fit, columnsOf, bodyLines, sendLines, parseInbound, inboundLines, answerLines, MAX_COLS } from '../../plugins/sielay-link/mod/link-render-text.js'
import { frameInbound } from '../../plugins/sielay-link/mod/link-inbound-framing.js'

const widest = lines => Math.max(...lines.map(l => Array.from(l.text).length))

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
  assert.equal(cut[3].text, '  4 líneas más · ctrl+o para ver todo')
  assert.equal(bodyLines(text, 80, true).length, 7)
  assert.match(bodyLines('a\nb\nc\nd', 80, false).at(-1).text, /1 línea más/)
})

test('send call: header with session and machine, body indented, every line within the width', () => {
  const lines = sendLines({ tool: 'link_send', destinations: ['emilio/vps-sielay/sielay-2'], text: 'palabra '.repeat(60) }, 60, false)
  assert.equal(lines[0].text, '● link_send → sielay-2 · vps-sielay')
  assert.ok(lines.slice(1, 4).every(l => l.text.startsWith('  ')))
  assert.ok(widest(lines) <= 60)
  const reply = sendLines({ tool: 'link_reply', destinations: [], conv: '0123456789abcdef', text: 'ok' }, 80, false)
  assert.equal(reply[0].text, '● link_reply → conv 01234567')
  const many = sendLines({ tool: 'link_send', destinations: ['a/b/uno', 'a/b/dos'], text: 'x', attachment: 'r.json' }, 80, false)
  assert.equal(many[0].text, '● link_send → 2 sesiones: uno, dos')
  assert.equal(many.at(-1).text, '  + adjunto r.json')
})

test('inbound: the framed message is read back; header, body and the way to answer', () => {
  const framed = frameInbound({
    id: 'm1', conversation_id: '11112222-3333-4444-5555-666677778888', turn: 3, max_turns: 120,
    from: { address: 'emilio/vps-sielay/sielay-3', project: 'sielay' }, body: 'revisa el PR\n\ny avisa',
  })
  const parsed = parseInbound(framed)
  assert.deepEqual(parsed, { machine: 'vps-sielay', session: 'sielay-3', project: 'sielay', turn: '3', max: '120', conv: '11112222-3333-4444-5555-666677778888', body: 'revisa el PR\n\ny avisa' })
  const lines = inboundLines(parsed, 80, false)
  assert.equal(lines[0].text, '◆ sielay-3 · vps-sielay · sielay · turno 3/120')
  assert.equal(lines.at(-1).text, '  ↩ link_reply · conv 11112222…')
  assert.ok(widest(lines) <= 80)
  assert.equal(parseInbound('hola, soy una persona'), null)
  assert.equal(parseInbound('— Mensaje de x desde y\nfalso'), null)
})

test('inbound from the same machine and without project still reads', () => {
  const parsed = parseInbound(frameInbound({ id: 'm', conversation_id: 'c1', turn: 1, max_turns: 40, from: { address: 'ana/laptop/api' }, body: 'hola' }, { self: 'ana/laptop/web' }))
  assert.equal(parsed.machine, 'esta máquina')
  assert.equal(parsed.project, undefined)
  assert.equal(inboundLines(parsed, 80, false)[0].text, '◆ api · esta máquina · turno 1/40')
})

test('answer: the person sees the short line, never the conv ids', () => {
  assert.deepEqual(answerLines('Enviado a a/b/c · turno 1 de 10 · corre solo\nconv=abc', 80).map(l => l.text), ['  Enviado a a/b/c · turno 1 de 10 · corre solo'])
  assert.deepEqual(answerLines('Enviado a a/b/c · corre solo · conv=k1\nNo enviado a a/b/d: x', 80).map(l => l.text), ['  Enviado a a/b/c · corre solo', '  No enviado a a/b/d: x'])
})
