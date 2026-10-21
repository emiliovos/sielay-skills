// The mod's mirror of the hub's `session.build` rules (sielay
// `server/lib/link-build-input-validation.js`, contracts §1 and §3): the mod
// checks a build before it goes in a poll, so the hub never gets one it would
// refuse. Pure. Unknown fields are left out; texts are scrubbed, then trimmed,
// then capped; a bad link is dropped, never fatal; anything else bad refuses
// the whole build, naming the first field that failed. The field checks and
// the limits live in link-build-fields.js.

import {
  BUILD_STAGES, BUILD_STATUSES, BUILD_ROLES, BUILD_OUTCOMES, BUILD_MAX_BYTES, BUILD_TEXT_MAX, BUILD_SUBAGENTS_MAX, SHORT_TEXT_MAX,
  Invalid, isObj, isCount, absent, hasSecret, text, date, stage, gate, delivery, links,
} from './link-build-fields.js'

export { BUILD_STAGES, BUILD_STATUSES, BUILD_ROLES, BUILD_MAX_BYTES, BUILD_TEXT_MAX, BUILD_SUBAGENTS_MAX }
export { BUILD_LINKS_MAX, BUILD_FUTURE_SKEW_MS } from './link-build-fields.js'

const FLAGS_MAX = 20
const BUILD_ID = /^[a-z0-9][a-z0-9._-]{2,79}$/
const AGENT_ID = /^[A-Za-z0-9_.:-]{1,128}$/
const USAGE_COUNTS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'turns']

/** @param {unknown} v @param {number} now */
function subagents(v, now) {
  if (absent(v)) return undefined
  if (!Array.isArray(v)) throw new Invalid('subagents')
  return v.slice(-BUILD_SUBAGENTS_MAX).map(s => {
    if (!isObj(s) || typeof s.id !== 'string' || !AGENT_ID.test(s.id) || hasSecret(s.id)) throw new Invalid('subagents.id')
    /** @type {Record<string, unknown>} */
    const out = { id: s.id }
    const parts = {
      type: text(s.type, SHORT_TEXT_MAX, 'subagents.type'),
      description: text(s.description, BUILD_TEXT_MAX.description, 'subagents.description'),
      started_at: date(s.started_at, now, 'subagents.started_at'),
    }
    for (const [k, val] of Object.entries(parts)) if (val !== undefined) out[k] = val
    if (s.model === null) out.model = null
    else if (s.model !== undefined) out.model = text(s.model, SHORT_TEXT_MAX, 'subagents.model') ?? null
    return out
  })
}

/** @param {unknown} v */
function usage(v) {
  if (v === null) return null
  if (v === undefined) return undefined
  if (!isObj(v)) throw new Invalid('usage')
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const k of USAGE_COUNTS) {
    if (!isCount(v[k])) throw new Invalid(`usage.${k}`)
    out[k] = v[k]
  }
  // Σ turn durations (1.1.1). Optional: an older hub ignores it.
  if (v.active_ms !== undefined) {
    if (!isCount(v.active_ms)) throw new Invalid('usage.active_ms')
    out.active_ms = v.active_ms
  }
  if (v.model === null) out.model = null
  else if (v.model !== undefined) out.model = text(v.model, SHORT_TEXT_MAX, 'usage.model') ?? null
  return out
}

/** @param {unknown} v */
function flags(v) {
  if (absent(v)) return undefined
  if (!Array.isArray(v)) throw new Invalid('flags')
  return v.map(f => text(f, SHORT_TEXT_MAX, 'flags')).filter(f => f !== undefined).slice(0, FLAGS_MAX)
}

/**
 * @param {unknown} input the build as it would travel in `session.build`
 * @param {number} now this clock, in ms
 * @returns {{ build: Record<string, unknown> | null, error?: undefined } | { build: undefined, error: string }}
 */
export function validateBuild(input, now) {
  if (input === null) return { build: null }
  try {
    if (!isObj(input)) throw new Invalid('build')
    if (typeof input.build_id !== 'string' || !BUILD_ID.test(input.build_id) || hasSecret(input.build_id)) throw new Invalid('build_id')
    if (!BUILD_ROLES.includes(input.role)) throw new Invalid('role')
    const st = stage(input.stage, 'stage')
    if (!BUILD_STATUSES.includes(input.status)) throw new Invalid('status')
    if (!absent(input.pr) && !(Number.isSafeInteger(input.pr) && input.pr > 0)) throw new Invalid('pr')
    const pp = input.plan_progress
    if (!absent(pp) && !(isObj(pp) && isCount(pp.done) && isCount(pp.total))) throw new Invalid('plan_progress')
    if (!absent(input.subagents_peak) && !isCount(input.subagents_peak)) throw new Invalid('subagents_peak')
    if (!absent(input.outcome) && !BUILD_OUTCOMES.includes(input.outcome)) throw new Invalid('outcome')

    /** @type {Record<string, unknown>} */
    const fields = {
      build_id: input.build_id, role: input.role, stage: st, status: input.status,
      title: text(input.title, BUILD_TEXT_MAX.title, 'title'),
      repo: text(input.repo, BUILD_TEXT_MAX.repo, 'repo'),
      plan: text(input.plan, BUILD_TEXT_MAX.plan, 'plan'),
      branch: text(input.branch, BUILD_TEXT_MAX.branch, 'branch'),
      pr: input.pr === null ? null : input.pr,
      flags: flags(input.flags),
      plan_progress: absent(pp) ? undefined : { done: pp.done, total: pp.total },
      phase: text(input.phase, BUILD_TEXT_MAX.phase, 'phase'),
      gate: gate(input.gate, now),
      summary: text(input.summary, BUILD_TEXT_MAX.summary, 'summary'),
      subagents: subagents(input.subagents, now),
      subagents_peak: absent(input.subagents_peak) ? undefined : input.subagents_peak,
      usage: usage(input.usage),
      delivery: delivery(input.delivery),
      linear: text(input.linear, BUILD_TEXT_MAX.linear, 'linear'),
      links: links(input.links),
      outcome: input.status === 'done' && !absent(input.outcome) ? input.outcome : undefined,
      stage_since: date(input.stage_since, now, 'stage_since'),
      started_at: date(input.started_at, now, 'started_at'),
    }
    const build = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
    if (new TextEncoder().encode(JSON.stringify(build)).length > BUILD_MAX_BYTES) throw new Invalid('too_big')
    return { build }
  } catch (err) {
    if (err instanceof Invalid) return { build: undefined, error: err.field }
    throw err
  }
}
