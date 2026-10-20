// The limits of `session.build` (contracts §1) and the field checks the
// validator (link-build-validate.js) is made of: texts, dates, stages, and the
// gate, delivery and links blocks. Mirrors the hub's
// `server/lib/link-build-input-validation.js` and `build-constants.js`. Pure.

import { scrubSecrets } from './link-secret-scrub.js'

export const BUILD_STAGES = Object.freeze(['frame', 'evidencia', 'plan', 'implementar', 'verificar', 'revisar', 'entregar'])
export const BUILD_STATUSES = Object.freeze(['running', 'waiting_approval', 'blocked', 'done'])
export const BUILD_ROLES = Object.freeze(['coordinator', 'worker'])
export const BUILD_OUTCOMES = Object.freeze(['delivered', 'stopped', 'failed'])
export const BUILD_MAX_BYTES = 8192
export const BUILD_TEXT_MAX = Object.freeze({ title: 120, summary: 600, description: 160, phase: 80, plan: 200, repo: 100, branch: 120, linear: 20, link: 300 })
export const BUILD_SUBAGENTS_MAX = 50
export const BUILD_LINKS_MAX = 10
/** How far ahead of this clock a date may be. */
export const BUILD_FUTURE_SKEW_MS = 5 * 60_000
/** The hub's cap for the texts §1 leaves unnamed (a flag, an agent type, a person, a model, a link label). */
export const SHORT_TEXT_MAX = 80

// At most milliseconds, as the hub takes them.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/
const STAMP = /^[0-9a-f]{7,40}$/i
const MERGE_PR = ['pending', 'running', 'merged', 'failed']

/** A field that refuses the whole build; `field` names it. */
export class Invalid extends Error {
  /** @param {string} field */
  constructor(field) {
    super(field)
    this.field = field
  }
}

/** @param {unknown} v @returns {v is Record<string, any>} */
export const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
/** @param {unknown} v */
export const isCount = v => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0
/** @param {unknown} v */
export const absent = v => v === undefined || v === null
/** @param {string} v true when the scrubber would change it (it carries a credential) */
export const hasSecret = v => scrubSecrets(v).removed > 0

/**
 * Scrubbed, trimmed and capped text (by code point: an emoji is never cut in
 * half); undefined when absent or empty.
 * @param {unknown} v @param {number} max @param {string} field
 */
export function text(v, max, field) {
  if (absent(v)) return undefined
  if (typeof v !== 'string') throw new Invalid(field)
  const clean = Array.from(scrubSecrets(v).text.trim()).slice(0, max).join('').trim()
  return clean === '' ? undefined : clean
}

/** @param {unknown} v @param {number} now @param {string} field */
export function date(v, now, field) {
  if (absent(v)) return undefined
  const ms = typeof v === 'string' && ISO_DATE.test(v) ? Date.parse(v) : NaN
  if (!Number.isFinite(ms) || ms > now + BUILD_FUTURE_SKEW_MS) throw new Invalid(field)
  return /** @type {string} */ (v)
}

/** @param {unknown} v @param {string} field */
export function stage(v, field) {
  if (!Number.isInteger(v) || /** @type {number} */ (v) < 1 || /** @type {number} */ (v) > BUILD_STAGES.length) throw new Invalid(field)
  return /** @type {number} */ (v)
}

/**
 * A link's href, or null when it must be dropped: `https:` URLs, or relative
 * paths that start with neither `/` nor `\` and carry no scheme, no control
 * character and no credential.
 * @param {unknown} href
 */
export function safeHref(href) {
  if (typeof href !== 'string') return null
  const h = href.trim()
  if (!h || h.length > BUILD_TEXT_MAX.link || /[\s\u0000-\u001f\u007f]/.test(h) || hasSecret(h)) return null
  if (SCHEME.test(h)) {
    try {
      return new URL(h).protocol === 'https:' ? h : null
    } catch {
      return null
    }
  }
  return /^[/\\]/.test(h) ? null : h
}

/** The gate of a stage: `stage` is required. @param {unknown} v @param {number} now */
export function gate(v, now) {
  if (absent(v)) return undefined
  if (!isObj(v)) throw new Invalid('gate')
  /** @type {Record<string, unknown>} */
  const out = { stage: stage(v.stage, 'gate.stage') }
  const by = text(v.approved_by, SHORT_TEXT_MAX, 'gate.approved_by')
  if (by !== undefined) out.approved_by = by
  const at = date(v.approved_at, now, 'gate.approved_at')
  if (at !== undefined) out.approved_at = at
  return out
}

/** @param {unknown} v */
export function delivery(v) {
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

/** Links with a safe href, at most BUILD_LINKS_MAX; the rest are dropped. @param {unknown} v */
export function links(v) {
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
