import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveSessionName,
  normalizeName,
  cwdHash,
} from '../../plugins/sielay-link/mod/link-session-name-resolution.js'

const all = {
  env: 'Env Name',
  saved: 'saved-name',
  projectFile: 'from-file',
  tmux: 'tmux-sess',
  nativeTitle: 'Native Title',
  cwd: '/srv/work/My Repo',
}

test('sources win in contract order: env, saved, project file, tmux, native, folder', () => {
  const order = ['env', 'saved', 'projectFile', 'tmux', 'nativeTitle']
  const expected = ['env-name', 'saved-name', 'from-file', 'tmux-sess', 'native-title']
  const sources = ['env', 'saved', 'project', 'tmux', 'native']
  let input = { ...all }
  for (let i = 0; i < order.length; i += 1) {
    assert.deepEqual(resolveSessionName(input), { name: expected[i], source: sources[i] })
    input = { ...input, [order[i]]: undefined }
  }
  assert.deepEqual(resolveSessionName(input), { name: 'my-repo', source: 'folder' })
})

test('a source that normalizes to nothing falls through to the next one', () => {
  assert.equal(resolveSessionName({ ...all, env: '  ***  ' }).source, 'saved')
})

test('no usable source at all gives "session"', () => {
  assert.deepEqual(resolveSessionName({ cwd: '/' }), { name: 'session', source: 'default' })
})

test('normalization: lowercase, [a-z0-9-], collapsed dashes, 40 chars max', () => {
  assert.equal(normalizeName('  Hola Mundo__API!! '), 'hola-mundo-api')
  assert.equal(normalizeName('áéí ñ'), 'aei-n')
  assert.equal(normalizeName('a'.repeat(60)), 'a'.repeat(40))
  assert.equal(normalizeName(`${'b'.repeat(39)}-x`), 'b'.repeat(39))
  assert.equal(normalizeName(null), '')
  assert.equal(normalizeName(42), '')
})

test('a Windows cwd yields its last folder', () => {
  assert.equal(resolveSessionName({ cwd: 'C:\\code\\Proyecto X\\' }).name, 'proyecto-x')
})

test('cwd_hash is stable, 32 hex chars, and differs per cwd', async () => {
  const a1 = await cwdHash('/srv/a')
  const a2 = await cwdHash('/srv/a')
  const b = await cwdHash('/srv/b')
  assert.equal(a1, a2)
  assert.notEqual(a1, b)
  assert.match(a1, /^[0-9a-f]{32}$/)
})
