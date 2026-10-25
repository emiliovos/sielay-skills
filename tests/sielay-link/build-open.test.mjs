// Several builds declared by one session: the current one keeps riding as
// `build`, the others as `open_builds`, until done or 24 h without a report.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { declareBuild, forgetIfDone, openBuildIds, pruneExpired } from '../../plugins/sielay-link/mod/link-build-state.js'
import { OPEN_BUILD_EXPIRY_MS, OPEN_BUILDS_MAX } from '../../plugins/sielay-link/mod/link-build-open.js'

const T0 = Date.parse('2026-10-25T12:00:00Z')
const decl = id => ({ build_id: id, role: 'coordinator', stage: 4, status: 'running' })

test('a second build displaces the first into open; the current one is never listed', () => {
  const a = declareBuild(null, decl('repo-a-one'), T0)
  const b = declareBuild(a, decl('repo-b-two'), T0 + 1000)
  assert.equal(b.declared.build_id, 'repo-b-two')
  assert.deepEqual(openBuildIds(b, T0 + 2000), ['repo-a-one'])
  const back = declareBuild(b, decl('repo-a-one'), T0 + 3000)
  assert.deepEqual(openBuildIds(back, T0 + 4000), ['repo-b-two'])
})

test('a build declared done is not kept open when another takes over', () => {
  const a = declareBuild(null, { ...decl('repo-a-one'), status: 'done', outcome: 'delivered' }, T0)
  assert.deepEqual(openBuildIds(declareBuild(a, decl('repo-b-two'), T0 + 1), T0 + 2), [])
})

test('a current build that goes out as done leaves a shell holding the others, then nothing', () => {
  const b = declareBuild(declareBuild(null, decl('repo-a-one'), T0), decl('repo-b-two'), T0 + 1)
  const done = declareBuild(b, { ...decl('repo-b-two'), status: 'done', outcome: 'delivered' }, T0 + 2)
  const shell = forgetIfDone(done, { build_id: 'repo-b-two', status: 'done' })
  assert.equal(shell.closed, true)
  assert.deepEqual(openBuildIds(shell, T0 + 3), ['repo-a-one'])
  assert.equal(forgetIfDone(shell, { build_id: 'repo-b-two', status: 'done' }), shell)
  // the last open one ends: declared done, sent, forgotten
  const last = declareBuild(shell, { ...decl('repo-a-one'), status: 'done', outcome: 'delivered' }, T0 + 4)
  assert.deepEqual(openBuildIds(last, T0 + 5), [])
  assert.equal(forgetIfDone(last, { build_id: 'repo-a-one', status: 'done' }), null)
})

test('a re-declared id after done starts a fresh build, not the closed shell', () => {
  const b = declareBuild(declareBuild(null, decl('repo-a-one'), T0), decl('repo-b-two'), T0 + 1)
  const shell = forgetIfDone(declareBuild(b, { ...decl('repo-b-two'), status: 'done' }, T0 + 2), { build_id: 'repo-b-two', status: 'done' })
  const again = declareBuild(shell, decl('repo-b-two'), T0 + 3)
  assert.equal(again.closed, undefined)
  assert.equal(again.started_at, new Date(T0 + 3).toISOString())
})

test('24 h without a report drops a build from open; a closed shell with none left is dropped', () => {
  const b = declareBuild(declareBuild(null, decl('repo-a-one'), T0), decl('repo-b-two'), T0 + 1)
  const late = T0 + OPEN_BUILD_EXPIRY_MS + 10
  assert.deepEqual(openBuildIds(b, late), [])
  assert.deepEqual(pruneExpired(b, late).open, {})
  const shell = forgetIfDone(declareBuild(b, { ...decl('repo-b-two'), status: 'done' }, T0 + 2), { build_id: 'repo-b-two', status: 'done' })
  assert.equal(pruneExpired(shell, late), null)
})

test('at most 12 others ride, the newest first', () => {
  let s = null
  for (let i = 0; i < 15; i++) s = declareBuild(s, decl(`repo-build-${String(i).padStart(2, '0')}`), T0 + i * 1000)
  const ids = openBuildIds(s, T0 + 20_000)
  assert.equal(ids.length, OPEN_BUILDS_MAX)
  assert.equal(ids[0], 'repo-build-13')
  assert.equal(ids.includes('repo-build-14'), false)
})
