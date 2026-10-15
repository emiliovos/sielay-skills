import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shortId, resolveStripId, isPersonOrigin, SHORT_ID_LEN } from '../../plugins/sielay-link/mod/link-strip-selection.js'

const strip = [{ id: '5f2a9c11-aaaa' }, { id: '5f2a0000-bbbb' }, { id: '9e0d1234-cccc' }]

test('the short id shown in the band and pane is the first 8 characters', () => {
  assert.equal(SHORT_ID_LEN, 8)
  assert.equal(shortId('5f2a9c11-aaaa'), '5f2a9c11')
})

test('resolve by exact id or by a unique prefix of at least the shown length', () => {
  assert.deepEqual(resolveStripId(strip, '9e0d1234-cccc'), { id: '9e0d1234-cccc' })
  assert.deepEqual(resolveStripId(strip, '9e0d1234'), { id: '9e0d1234-cccc' })
  assert.deepEqual(resolveStripId(strip, '  5f2a9c11 '), { id: '5f2a9c11-aaaa' })
})

test('ambiguous, too short, missing or absent ids are refused, never guessed', () => {
  assert.match(resolveStripId(strip, '5f2a').error, /8/)
  assert.match(resolveStripId(strip, '').error, /Uso/)
  assert.match(resolveStripId(strip, 'deadbeef').error, /no está en la franja/)
  assert.match(resolveStripId([{ id: 'abcdefgh-1' }, { id: 'abcdefgh-2' }], 'abcdefgh').error, /varios/)
})

test('only the person at the terminal (composer) may accept or reject', () => {
  assert.equal(isPersonOrigin({ kind: 'composer' }), true)
  for (const kind of ['plugin', 'peer', 'sdk', 'bridge', 'unclassified', 'channel', 'auto-continuation']) {
    assert.equal(isPersonOrigin({ kind }), false, kind)
  }
  assert.equal(isPersonOrigin(undefined), false)
})
