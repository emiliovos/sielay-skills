// The mod's mirror of the hub's session.build rules. The cases carry the names
// of the hub's example payloads (another repo, so names only, not the files).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateBuild, BUILD_MAX_BYTES, BUILD_TEXT_MAX, BUILD_LINKS_MAX } from '../../plugins/sielay-link/mod/link-build-validate.js'

const NOW = Date.parse('2026-10-20T23:10:00.000Z')
const iso = ms => new Date(ms).toISOString()

const validFull = () => ({
  build_id: '261020-builds-viewer',
  role: 'coordinator',
  stage: 4,
  status: 'running',
  title: 'Visor de builds autónomos',
  repo: 'emiliovos/sielay',
  plan: 'plans/261020-builds-viewer/plan.md',
  branch: 'feat/builds-viewer',
  pr: 340,
  flags: ['--terminales', '--alcance produccion'],
  plan_progress: { done: 2, total: 7 },
  phase: 'phase-03',
  gate: { stage: 3, approved_by: 'emilio', approved_at: '2026-10-20T22:30:00.000Z' },
  summary: 'Plan aprobado: 7 fases; la 5 en paralelo con la 1.',
  subagents: [{ id: 'a1b2', type: 'fullstack-developer', description: 'Fase 1: hub', started_at: '2026-10-20T23:01:00.000Z' }],
  subagents_peak: 3,
  usage: { input_tokens: 120000, output_tokens: 18000, cache_read_input_tokens: 900000, cache_creation_input_tokens: 40000, turns: 41 },
  delivery: { merge_pr: 'pending', stamp: null, deploy_pending: true },
  linear: 'VOS-260',
  links: [{ label: 'brainstorm', href: 'plans/reports/brainstorm-261020-builds-viewer.md' }],
  stage_since: '2026-10-20T23:00:00.000Z',
  started_at: '2026-10-20T21:40:00.000Z',
})
const validMin = () => ({ build_id: 'abc', role: 'worker', stage: 1, status: 'running' })

test('valid-full: every field of the contract comes back as sent', () => {
  const { build, error } = validateBuild(validFull(), NOW)
  assert.equal(error, undefined)
  assert.deepEqual(build, validFull())
})

test('valid-min: only the four required fields', () => {
  assert.deepEqual(validateBuild(validMin(), NOW), { build: validMin() })
})

test('null: the session leaves its build (valid, build null)', () => {
  assert.deepEqual(validateBuild(null, NOW), { build: null })
})

test('too-big: over BUILD_MAX_BYTES is refused whole, naming the size', () => {
  const big = { ...validFull(), subagents: Array.from({ length: 50 }, (_, i) => ({ id: `agent-${i}`, type: 'x'.repeat(60), description: 'é'.repeat(160), started_at: '2026-10-20T23:01:00.000Z' })) }
  const r = validateBuild(big, NOW)
  assert.equal(r.build, undefined)
  assert.equal(r.error, 'too_big')
  assert.ok(Buffer.byteLength(JSON.stringify(big)) > BUILD_MAX_BYTES)
})

test('stage-0 and stage-8: stage is an integer 1..7', () => {
  for (const stage of [0, 8, 3.5, '4', null]) assert.deepEqual(validateBuild({ ...validMin(), stage }, NOW), { build: undefined, error: 'stage' }, String(stage))
})

test('bad-status: status outside the four', () => {
  assert.deepEqual(validateBuild({ ...validMin(), status: 'paused' }, NOW), { build: undefined, error: 'status' })
})

test('the required fields and their shapes', () => {
  assert.equal(validateBuild({ ...validMin(), build_id: 'A-B' }, NOW).error, 'build_id')
  assert.equal(validateBuild({ ...validMin(), build_id: 'ab' }, NOW).error, 'build_id')
  assert.equal(validateBuild({ ...validMin(), build_id: 'x'.repeat(81) }, NOW).error, 'build_id')
  assert.equal(validateBuild({ ...validMin(), role: 'boss' }, NOW).error, 'role')
  const { role, ...noRole } = validMin()
  assert.equal(validateBuild(noRole, NOW).error, 'role')
  assert.equal(validateBuild('build', NOW).error, 'build')
  assert.equal(validateBuild([], NOW).error, 'build')
})

test('secret-in-summary: secrets are scrubbed field by field, before the length cap', () => {
  const secret = 'slk_' + 'a'.repeat(24)
  const r = validateBuild({ ...validMin(), summary: `ok password=hunter2 y ${secret}`, title: `t ${secret}`, flags: [`--token=${secret}`] }, NOW)
  assert.equal(r.error, undefined)
  assert.equal(r.build.summary, 'ok password=[secreto-removido] y [secreto-removido]')
  assert.equal(r.build.title, 't [secreto-removido]')
  assert.ok(!JSON.stringify(r.build).includes(secret))
  // scrub first: a secret cut by the cap would otherwise leave its head behind
  const tail = validateBuild({ ...validMin(), title: 'x'.repeat(BUILD_TEXT_MAX.title - 10) + ' ' + secret }, NOW)
  assert.ok(!tail.build.title.includes('slk_'))
})

test('texts are trimmed and capped by BUILD_TEXT_MAX; empty ones are dropped', () => {
  const r = validateBuild({ ...validMin(), summary: `  ${'s'.repeat(700)}  `, title: '   ', phase: ' phase-01 ' }, NOW)
  assert.equal(r.build.summary.length, BUILD_TEXT_MAX.summary)
  assert.equal(r.build.title, undefined)
  assert.equal(r.build.phase, 'phase-01')
  assert.equal(validateBuild({ ...validMin(), summary: 42 }, NOW).error, 'summary')
})

test('future-date: a date more than 5 min ahead of the clock is refused; ISO 8601 only', () => {
  assert.equal(validateBuild({ ...validMin(), stage_since: iso(NOW + 10 * 60_000) }, NOW).error, 'stage_since')
  assert.equal(validateBuild({ ...validMin(), stage_since: iso(NOW + 4 * 60_000) }, NOW).error, undefined)
  assert.equal(validateBuild({ ...validMin(), started_at: 'ayer' }, NOW).error, 'started_at')
  assert.equal(validateBuild({ ...validMin(), gate: { stage: 3, approved_at: iso(NOW + 3600_000) } }, NOW).error, 'gate.approved_at')
  assert.equal(validateBuild({ ...validMin(), subagents: [{ id: 'a1', started_at: iso(NOW + 3600_000) }] }, NOW).error, 'subagents.started_at')
})

test('bad-link-scheme: only relative paths and https: links survive; the rest are dropped, not fatal', () => {
  const links = [
    { label: 'ok rel', href: 'plans/x.md' },
    { label: 'ok https', href: 'https:' + '//github.com/emiliovos/sielay/pull/340' },
    { label: 'js', href: 'javascript:alert(1)' },
    { label: 'http', href: 'http:' + '//example.com' },
    { label: 'abs', href: '/etc/passwd' },
    { label: 'back', href: '\\\\host\\x' },
    { label: 'proto-rel', href: '//evil.example/x' },
    { label: 'data', href: 'data:text/html,x' },
    { label: 'long', href: 'p/' + 'x'.repeat(BUILD_TEXT_MAX.link) },
  ]
  const r = validateBuild({ ...validMin(), links }, NOW)
  assert.equal(r.error, undefined)
  assert.deepEqual(r.build.links.map(l => l.label), ['ok rel', 'ok https'])
  const many = Array.from({ length: 15 }, (_, i) => ({ label: `l${i}`, href: `p/${i}.md` }))
  assert.equal(validateBuild({ ...validMin(), links: many }, NOW).build.links.length, BUILD_LINKS_MAX)
})

test('pr, delivery, usage and plan_progress shapes', () => {
  assert.equal(validateBuild({ ...validMin(), pr: 0 }, NOW).error, 'pr')
  assert.equal(validateBuild({ ...validMin(), pr: null }, NOW).build.pr, null)
  assert.equal(validateBuild({ ...validMin(), delivery: { merge_pr: 'done' } }, NOW).error, 'delivery.merge_pr')
  assert.equal(validateBuild({ ...validMin(), delivery: { stamp: 'xyz' } }, NOW).error, 'delivery.stamp')
  assert.equal(validateBuild({ ...validMin(), delivery: { stamp: 'abc1234' } }, NOW).error, undefined)
  assert.equal(validateBuild({ ...validMin(), usage: { input_tokens: -1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, turns: 0 } }, NOW).error, 'usage.input_tokens')
  assert.equal(validateBuild({ ...validMin(), usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, turns: 1.5 } }, NOW).error, 'usage.turns')
  assert.equal(validateBuild({ ...validMin(), usage: null }, NOW).build.usage, null)
  const counts = { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, turns: 1 }
  assert.equal(validateBuild({ ...validMin(), usage: { ...counts, active_ms: 90_000 } }, NOW).build.usage.active_ms, 90_000)
  assert.equal('active_ms' in validateBuild({ ...validMin(), usage: counts }, NOW).build.usage, false, 'optional: absent stays absent')
  for (const bad of [-1, 1.5, '9', 2 ** 53, null]) assert.equal(validateBuild({ ...validMin(), usage: { ...counts, active_ms: bad } }, NOW).error, 'usage.active_ms', String(bad))
  const withModel = validateBuild({ ...validMin(), usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, turns: 1, model: null } }, NOW)
  assert.equal(withModel.build.usage.model, null)
  assert.equal(validateBuild({ ...validMin(), plan_progress: { done: -1, total: 7 } }, NOW).error, 'plan_progress')
})

test('outcome: kept only with status done; unknown values refused; unknown fields ignored', () => {
  assert.equal(validateBuild({ ...validMin(), status: 'done', outcome: 'delivered' }, NOW).build.outcome, 'delivered')
  assert.equal(validateBuild({ ...validMin(), outcome: 'delivered' }, NOW).build.outcome, undefined)
  assert.equal(validateBuild({ ...validMin(), status: 'done', outcome: 'won' }, NOW).error, 'outcome')
  assert.equal(validateBuild({ ...validMin(), extra: 'x', html: '<b>' }, NOW).build.extra, undefined)
})

test('gate: stage is required, as the hub requires it', () => {
  assert.equal(validateBuild({ ...validMin(), gate: { approved_by: 'emilio', approved_at: '2026-10-20T22:30:00.000Z' } }, NOW).error, 'gate.stage')
  assert.equal(validateBuild({ ...validMin(), gate: { stage: 3 } }, NOW).error, undefined)
})

test('dates carry at most milliseconds (3 decimals), as the hub reads them', () => {
  assert.equal(validateBuild({ ...validMin(), started_at: '2026-10-20T23:00:00.123456Z' }, NOW).error, 'started_at')
  assert.equal(validateBuild({ ...validMin(), started_at: '2026-10-20T23:00:00.123Z' }, NOW).error, undefined)
})

test('integers must be safe; ids that carry a credential are refused; a DEL in an href drops the link', () => {
  assert.equal(validateBuild({ ...validMin(), pr: 2 ** 53 }, NOW).error, 'pr')
  assert.equal(validateBuild({ ...validMin(), plan_progress: { done: 2 ** 53, total: 1 } }, NOW).error, 'plan_progress')
  assert.equal(validateBuild({ ...validMin(), build_id: 'sk-' + 'a'.repeat(24) }, NOW).error, 'build_id')
  assert.equal(validateBuild({ ...validMin(), subagents: [{ id: 'slk_' + 'b'.repeat(20) }] }, NOW).error, 'subagents.id')
  assert.deepEqual(validateBuild({ ...validMin(), links: [{ href: 'plans/a\x7fb.md' }, { href: 'plans/ok.md' }] }, NOW).build.links, [{ href: 'plans/ok.md' }])
})

test('flow encargo: stage 1..4 pass, a later stage refuses the report; other flows keep 1..7', () => {
  for (const stage of [1, 2, 3, 4]) assert.equal(validateBuild({ ...validMin(), stage, flow: 'encargo' }, NOW).build.stage, stage)
  assert.equal(validateBuild({ ...validMin(), stage: 5, flow: 'encargo' }, NOW).error, 'stage')
  for (const flow of ['full', 'chico', 'fix']) assert.equal(validateBuild({ ...validMin(), stage: 7, flow }, NOW).build.stage, 7)
})
