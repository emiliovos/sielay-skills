import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSendHeaders, checkSendHeader } from '../../plugins/sielay-link/mod/link-send-headers.js'
import { runLinkTool } from '../../plugins/sielay-link/mod/link-tools.js'

const SPEC = 'DECISIÓN #k|AVANCE|ALERTA|DUDA #k'
const rule = parseSendHeaders(SPEC)

test('sin la variable no se exige encabezado', () => {
  assert.equal(parseSendHeaders(undefined), null)
  assert.equal(parseSendHeaders('  |  '), null)
  assert.equal(checkSendHeader('hola', null), null)
})

test('la primera línea no vacía con un encabezado pasa; #k pide un número', () => {
  for (const t of ['AVANCE\nPR abierto', 'ALERTA: CI caído', 'DUDA #3 ¿merge?', 'DECISIÓN #98', '\n  AVANCE · listo']) {
    assert.equal(checkSendHeader(t, rule), null, t)
  }
})

test('sin encabezado, sin número o con una palabra que solo empieza igual se niega', () => {
  for (const t of ['hola', 'DUDA ¿merge?', 'DECISIÓN tomada', 'AVANCES del día', 'avance', 'Te cuento\nAVANCE']) {
    assert.match(checkSendHeader(t, rule), /Mensaje sin encabezado: .*«DUDA #k»/, t)
  }
})

test('los caracteres de regex en la variable se toman literales', () => {
  const r = parseSendHeaders('[x]|a.b')
  assert.equal(checkSendHeader('[x] hola', r), null)
  assert.ok(checkSendHeader('aXb hola', r))
})

const deps = sent => ({
  client: { send: async b => (sent.push(b), { id: 'm', conversation_id: 'c1', turn: 1, turns_left: 9, gate: 'auto', status: 'queued' }), peers: async () => ({}) },
  sessionFrom: async () => ({ name: 'api' }),
  conversationPeer: async () => 'a/b/c',
  rememberConversation: async () => {},
  newId: () => 'id',
  selfAddress: async () => undefined,
  sendHeaders: SPEC,
})

test('link_send sin encabezado se niega antes del hub; con encabezado se manda', async () => {
  const sent = []
  const d = deps(sent)
  assert.ok((await runLinkTool('link_send', { to: 'a/b/c', text: 'hola' }, d)).deny)
  assert.ok((await runLinkTool('link_send', { to: ['a/b/c', 'a/b/d'], text: 'hola' }, d)).deny)
  assert.equal(sent.length, 0)
  assert.ok((await runLinkTool('link_send', { to: 'a/b/c', text: 'AVANCE\nhola' }, d)).result)
  assert.equal(sent.length, 1)
})

test('link_reply queda libre', async () => {
  const sent = []
  const r = await runLinkTool('link_reply', { conversation: 'c1', text: 'ok' }, deps(sent))
  assert.equal(r.deny, undefined)
  assert.equal(sent.length, 1)
})
