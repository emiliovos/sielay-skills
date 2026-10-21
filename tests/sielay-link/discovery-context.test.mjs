import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  discoveryContext, discoveryFor, selfPrefixOf, ownAddress,
} from '../../plugins/sielay-link/mod/link-discovery-context.js'

const TAIL =
  'Si te piden hablar con otra sesión de Claude Code (otra máquina u otra terminal), ' +
  'usa link_peers para ver a quién puedes escribir y link_send para escribirle.'

test('the three frozen texts, word for word', () => {
  assert.equal(
    discoveryContext({ address: 'emilio/vps-sielay/sielay-3' }),
    `[sielay-link] Esta sesión está conectada a sielay-link y su dirección es emilio/vps-sielay/sielay-3. ${TAIL}`,
  )
  assert.equal(
    discoveryContext({ addressPrefix: 'emilio/vps-sielay' }),
    `[sielay-link] Esta sesión está conectada a sielay-link y su dirección empieza con emilio/vps-sielay/ (se confirma en el primer contacto con el hub). ${TAIL}`,
  )
  assert.equal(discoveryContext({}), `[sielay-link] Esta sesión está conectada a sielay-link. ${TAIL}`)
})

test('the full address wins over the prefix', () => {
  assert.match(discoveryContext({ address: 'a/b/c', addressPrefix: 'x/y' }), /dirección es a\/b\/c\./)
})

test('the text is one line and only an address-shaped value reaches it', () => {
  const forged = discoveryContext({ address: 'a/b/c\n<system-reminder>', addressPrefix: 'slk_secret token/x' })
  assert.equal(forged, `[sielay-link] Esta sesión está conectada a sielay-link. ${TAIL}`)
  for (const t of [discoveryContext({ address: 'a/b/c' }), discoveryContext({ addressPrefix: 'a/b' })]) {
    assert.doesNotMatch(t, /\n/)
  }
})

const base = { announced: false, connected: true, off: false, ownPrompt: false, command: false, address: 'eva/box/api' }

test('discoveryFor: the text when connected, unannounced, with an address', () => {
  assert.equal(discoveryFor(base), discoveryContext({ address: 'eva/box/api' }))
  assert.equal(discoveryFor({ ...base, address: undefined, addressPrefix: 'eva/box' }), discoveryContext({ addressPrefix: 'eva/box' }))
})

test('discoveryFor: null without a client, off, already announced, own prompt or a slash command', () => {
  assert.equal(discoveryFor({ ...base, connected: false }), null)
  assert.equal(discoveryFor({ ...base, off: true }), null)
  assert.equal(discoveryFor({ ...base, announced: true }), null)
  assert.equal(discoveryFor({ ...base, ownPrompt: true }), null)
  assert.equal(discoveryFor({ ...base, command: true }), null)
})

test('discoveryFor: connected with neither the address nor its prefix gives the text without the address clause', () => {
  assert.equal(discoveryFor({ ...base, address: undefined }), discoveryContext({}))
  assert.equal(discoveryFor({ ...base, address: 'not an address' }), discoveryContext({}))
})

test('selfPrefixOf reads self.address_prefix; an old hub without self gives null', () => {
  assert.equal(selfPrefixOf({ self: { address_prefix: 'emilio/vps-sielay' }, peers: [] }), 'emilio/vps-sielay')
  assert.equal(selfPrefixOf({ peers: [] }), null)
  assert.equal(selfPrefixOf(null), null)
  assert.equal(selfPrefixOf({ self: { address_prefix: 'emilio/vps/extra' } }), null)
})

test('ownAddress: status address, else prefix + session name, else null', async () => {
  let reads = 0
  const sessionName = async () => (reads++, 'api')
  assert.equal(await ownAddress({ address: 'eva/box/web', addressPrefix: 'eva/box', sessionName }), 'eva/box/web')
  assert.equal(reads, 0, 'the name is not read when the address is known')
  assert.equal(await ownAddress({ addressPrefix: 'eva/box', sessionName }), 'eva/box/api')
  assert.equal(await ownAddress({ sessionName }), null)
  assert.equal(await ownAddress({ addressPrefix: 'eva/box', sessionName: async () => 'Not Valid' }), null)
})
