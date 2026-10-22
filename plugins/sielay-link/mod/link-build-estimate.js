// The `estimate` of a build (contracts §1): the clock hours /si:build-auto
// expects, by phase, and the assumption they hang on. Mirrors the hub's rules
// and its error names. Hours are rounded to 0.1 first and checked after; names
// and texts are scrubbed of secrets, trimmed and capped like every build text.
// The output always carries its four keys, in a fixed order. Pure.

import {
  BUILD_TEXT_MAX, BUILD_ESTIMATE_PHASES_MAX, BUILD_ESTIMATE_H_MAX, BUILD_ESTIMATE_MAX_BYTES,
  Invalid, isObj, absent, text,
} from './link-build-fields.js'

/**
 * @typedef {{
 *   total_h: number,
 *   phases: { name: string, h: number }[],
 *   assumption: string | null,
 *   reason: string | null,
 * }} BuildEstimate
 */

/**
 * Hours rounded to 0.1, or NaN when the value is not a finite number.
 * @param {unknown} v
 */
function hours(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : NaN
}

/** @param {unknown} v */
function phases(v) {
  if (absent(v)) return []
  if (!Array.isArray(v) || v.length > BUILD_ESTIMATE_PHASES_MAX) throw new Invalid('estimate.phases')
  return v.map(p => {
    if (!isObj(p)) throw new Invalid('estimate.phases')
    const name = text(p.name, BUILD_TEXT_MAX.phase, 'estimate.phases')
    const h = hours(p.h)
    if (name === undefined || !(h >= 0 && h <= BUILD_ESTIMATE_H_MAX)) throw new Invalid('estimate.phases')
    return { name, h }
  })
}

/**
 * The normalized estimate, or undefined when absent or null (the build keeps
 * the one it had). Throws Invalid naming the field that failed.
 * @param {unknown} v
 * @returns {BuildEstimate | undefined}
 */
export function estimate(v) {
  if (absent(v)) return undefined
  if (!isObj(v)) throw new Invalid('estimate')
  const total = hours(v.total_h)
  if (!(total > 0 && total <= BUILD_ESTIMATE_H_MAX)) throw new Invalid('estimate.total_h')
  /** @type {BuildEstimate} */
  const out = {
    total_h: total,
    phases: phases(v.phases),
    assumption: text(v.assumption, BUILD_TEXT_MAX.assumption, 'estimate.assumption') ?? null,
    reason: text(v.reason, BUILD_TEXT_MAX.reason, 'estimate.reason') ?? null,
  }
  if (new TextEncoder().encode(JSON.stringify(out)).length > BUILD_ESTIMATE_MAX_BYTES) throw new Invalid('estimate')
  return out
}
