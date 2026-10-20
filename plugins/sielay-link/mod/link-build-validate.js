// The mod's mirror of the hub's `session.build` rules (sielay
// `server/lib/link-build-input-validation.js`, contracts §1 and §3): the mod
// checks a build before it goes in a poll, so an invalid one is never sent.
// Pure. Unknown fields are left out; texts are scrubbed, then trimmed, then
// capped; a bad link is dropped, never fatal; anything else bad refuses the
// whole build, naming the first field that failed.

import { scrubSecrets } from './link-secret-scrub.js'

export const BUILD_STAGES = Object.freeze(['frame', 'evidencia', 'plan', 'implementar', 'verificar', 'revisar', 'entregar'])
export const BUILD_STATUSES = Object.freeze(['running', 'waiting_approval', 'blocked', 'done'])
export const BUILD_ROLES = Object.freeze(['coordinator', 'worker'])
export const BUILD_MAX_BYTES = 8192
export const BUILD_TEXT_MAX = Object.freeze({ title: 120, summary: 600, description: 160, phase: 80, plan: 200, repo: 100, branch: 120, linear: 20, link: 300 })
export const BUILD_SUBAGENTS_MAX = 50
export const BUILD_LINKS_MAX = 10
/** How far ahead of this clock a date may be. */
export const BUILD_FUTURE_SKEW_MS = 5 * 60_000
/** Caps for the texts §1 leaves unnamed (a flag, an agent type, a person, a model, a link label). */
const SHORT_TEXT_MAX = 80
const FLAGS_MAX = 20

const BUILD_ID = /^[a-z0-9][a-z0-9._-]{2,79}$/
const AGENT_ID = /^[A-Za-z0-9_.:-]{1,128}$/
const STAMP = /^[0-9a-f]{7,40}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/
const MERGE_PR = ['pending', 'running', 'merged', 'failed']
const OUTCOMES = ['delivered', 'stopped', 'failed']
const USAGE_COUNTS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'turns']

class Invalid extends Error {
  /** @param {string} field */
  constructor(field) {
    super(field)
    this.field = field
  }
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
/** @param {unknown} v */
const isCount = v => Number.isInteger(v) && /** @type {number} */ (v) >= 0
/** @param {unknown} v */
const absent = v => v === undefined || v === null

/**
 * Scrubbed, trimmed and capped text; undefined when absent or empty.
 * @param {unknown} v @param {number} max @param {string} field
 */
function text(v, max, field) {
  if (absent(v)) return undefined
  if (typeof v !== 'string') throw new Invalid(field)
  const clean = scrubSecrets(v).text.trim().slice(0, max).trim()
  return clean === '' ? undefined : clean
}

/** @param {unknown} v @param {number} now @param {string} field */
function date(v, now, field) {
  if (absent(v)) return undefined
  const ms = typeof v === 'string' && ISO_DATE.test(v) ? Date.parse(v) : NaN
  if (!Number.isFinite(ms) || ms > now + BUILD_FUTURE_SKEW_MS) throw new Invalid(field)
  return /** @type {string} */ (v)
}

/** @param {unknown} v @param {string} field */
function stage(v, field) {
  if (!Number.isInteger(v) || /** @type {number} */ (v) < 1 || /** @type {number} */ (v) > BUILD_STAGES.length) throw new Invalid(field)
  return /** @type {number} */ (v)
}

/**
 * A link's href, or null when it must be dropped: `https:` URLs, or relative
 * paths that start with neither `/` nor `\` and carry no scheme.
 * @param {unknown} href
 */
function safeHref(href) {
  if (typeof href !== 'string') return null
  const h = href.trim()
  if (!h || h.length > BUILD_TEXT_MAX.link || /[\s\u0000-\u001f]/.test(h) || scrubSecrets(h).removed) return null
  if (SCHEME.test(h)) {
    try {
      return new URL(h).protocol === 'https:' ? h : null
    } catch {
      return null
    }
  }
  return /^[/\\]/.test(h) ? null : h
}

/** @param {unknown} v @param {number} now */
function subagents(v, now) {
  if (absent(v)) return undefined
  if (!Array.isArray(v)) throw new Invalid('subagents')
  return v.slice(-BUILD_SUBAGENTS_MAX).map(s => {
    if (!isObj(s) || typeof s.id !== 'string' || !AGENT_ID.test(s.id)) throw new Invalid('subagents.id')
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
  if (v.model === null) out.model = null
  else if (v.model !== undefined) out.model = text(v.model, SHORT_TEXT_MAX, 'usage.model') ?? null
  return out
}

/** @param {unknown} v @param {number} now */
function gate(v, now) {
  if (absent(v)) return undefined
  if (!isObj(v)) throw new Invalid('gate')
  /** @type {Record<string, unknown>} */
  const out = {}
  if (!absent(v.stage)) out.stage = stage(v.stage, 'gate.stage')
  const by = text(v.approved_by, SHORT_TEXT_MAX, 'gate.approved_by')
  if (by !== undefined) out.approved_by = by
  const at = date(v.approved_at, now, 'gate.approved_at')
  if (at !== undefined) out.approved_at = at
  return out
}

/** @param {unknown} v */
function delivery(v) {
  if (absent(v)) return undefined
  if (!isObj(v)) throw new Invalid('delivery')
  /** @type {Record<string, unknown>} */
  const out = {}
  if (v.merge_pr !== undefined) {
    if (v.merge_pr !== null && !MERGE_PR.includes(v.merge_pr)) throw new Invalid('delivery.merge_pr')
    out.merge_pr = v.merge_pr
  }
  if (v.stamp !== undefined) {
    if (v.stamp !== null && (typeof v.stamp !== 'string' || !STAMP.test(v.stamp))) throw new Invalid('delivery.stamp')
    out.stamp = v.stamp
  }
  if (v.deploy_pending !== undefined) {
    if (v.deploy_pending !== null && typeof v.deploy_pending !== 'boolean') throw new Invalid('delivery.deploy_pending')
    out.deploy_pending = v.deploy_pending
  }
  return out
}

/** @param {unknown} v */
function links(v) {
  if (absent(v)) return undefined
  if (!Array.isArray(v)) throw new Invalid('links')
  /** @type {{ label?: string, href: string }[]} */
  const out = []
  for (const l of v) {
    const href = isObj(l) ? safeHref(l.href) : null
    if (!href || !isObj(l)) continue
    const label = text(l.label, SHORT_TEXT_MAX, 'links.label')
    out.push(label === undefined ? { href } : { label, href })
    if (out.length === BUILD_LINKS_MAX) break
  }
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
    if (typeof input.build_id !== 'string' || !BUILD_ID.test(input.build_id)) throw new Invalid('build_id')
    if (!BUILD_ROLES.includes(input.role)) throw new Invalid('role')
    const st = stage(input.stage, 'stage')
    if (!BUILD_STATUSES.includes(input.status)) throw new Invalid('status')
    if (!absent(input.pr) && !(Number.isInteger(input.pr) && input.pr > 0)) throw new Invalid('pr')
    const pp = input.plan_progress
    if (!absent(pp) && !(isObj(pp) && isCount(pp.done) && isCount(pp.total))) throw new Invalid('plan_progress')
    if (!absent(input.subagents_peak) && !isCount(input.subagents_peak)) throw new Invalid('subagents_peak')
    if (!absent(input.outcome) && !OUTCOMES.includes(input.outcome)) throw new Invalid('outcome')

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
