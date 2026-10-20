// The mod's copy of the hub's secret scrubber: the shapes it must remove.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrubSecrets, SECRET_PLACEHOLDER as P } from '../../plugins/sielay-link/mod/link-secret-scrub.js'

test('key/value pairs keep the key and lose the value', () => {
  assert.equal(scrubSecrets('db_password=hunter2 y api_key: abc').text, `db_password=${P} y api_key: ${P}`)
  assert.equal(scrubSecrets('{"token": "x1"}').text, `{"token": "${P}"}`)
})

test('bearer tokens, URL passwords and known token shapes', () => {
  const r = scrubSecrets(`Bearer ${'A'.repeat(20)} https:` + `//ana:s3cret@host/x slk_${'b'.repeat(20)}`)
  assert.equal(r.text, `Bearer ${P} https://ana:${P}@host/x ${P}`)
  assert.equal(r.removed, 3)
})

test('PEM blocks, and a private key with no END cut to the end', () => {
  const begin = (l) => `-----BEGIN ${l}-----`
  const end = (l) => `-----END ${l}-----`
  assert.equal(scrubSecrets(`a ${begin('CERTIFICATE')}\nxyz\n${end('CERTIFICATE')} b`).text, `a ${P} b`)
  assert.equal(scrubSecrets(`a ${begin('RSA PRIVATE KEY')}\nxyz`).text, `a ${P}`)
  assert.equal(scrubSecrets(`${begin('CERTIFICATE')} x ${end('OTHER')}`).removed, 0)
})

test('idempotent, and non-strings become empty text', () => {
  const once = scrubSecrets('password=x').text
  assert.deepEqual(scrubSecrets(once), { text: once, removed: 0 })
  assert.deepEqual(scrubSecrets(42), { text: '', removed: 0 })
})
