// The newer, optional blocks of a build: `flow`, `stage_detail` (the evidence
// and live status of one stage) and the delivery's `merge_queue` and `deploy`.
// Mirrors the hub's checks, never looser. Absent fields change nothing. Pure.

import { Invalid, isObj, isCount, absent, text, date, stage, safeHref, BUILD_TEXT_MAX } from './link-build-fields.js'

export const BUILD_FLOWS = Object.freeze(['full', 'chico', 'fix', 'encargo'])
export const DEPLOY_STATES = Object.freeze(['approval', 'publishing', 'verified', 'failed'])
export const DETAIL_ITEMS_MAX = 8
export const DETAIL_TEXT_MAX = Object.freeze({ label: 80, value: 160, live: 120, reason: 120 })

/** @param {unknown} v */
export function flow(v) {
  if (absent(v)) return undefined
  if (!BUILD_FLOWS.includes(/** @type {string} */ (v))) throw new Invalid('flow')
  return v
}

/** @param {unknown} v */
function item(v) {
  if (!isObj(v)) throw new Invalid('stage_detail.items')
  const label = text(v.label, DETAIL_TEXT_MAX.label, 'stage_detail.items.label')
  if (label === undefined) throw new Invalid('stage_detail.items.label')
  /** @type {Record<string, unknown>} */
  const out = { label }
  const value = text(v.value, DETAIL_TEXT_MAX.value, 'stage_detail.items.value')
  if (value !== undefined) out.value = value
  const href = safeHref(v.href)
  if (href) out.href = href
  return out
}

/** @param {unknown} v @param {number} now */
function live(v, now) {
  if (v === null) return null
  if (!isObj(v)) throw new Invalid('stage_detail.live')
  const label = text(v.label, DETAIL_TEXT_MAX.live, 'stage_detail.live.label')
  if (label === undefined) throw new Invalid('stage_detail.live.label')
  /** @type {Record<string, unknown>} */
  const out = { label }
  for (const k of /** @type {const} */ (['done', 'total'])) {
    if (absent(v[k])) continue
    if (!isCount(v[k])) throw new Invalid(`stage_detail.live.${k}`)
    out[k] = v[k]
  }
  const at = date(v.at, now, 'stage_detail.live.at')
  if (at !== undefined) out.at = at
  return out
}

/**
 * The detail of one stage: the last one sent is kept whole. `live: null`
 * travels as null (the hub clears it); items past the 8th are cut.
 * @param {unknown} v @param {number} now
 */
export function stageDetail(v, now) {
  if (absent(v)) return undefined
  if (!isObj(v)) throw new Invalid('stage_detail')
  /** @type {Record<string, unknown>} */
  const out = { stage: stage(v.stage, 'stage_detail.stage') }
  if (!absent(v.items)) {
    if (!Array.isArray(v.items)) throw new Invalid('stage_detail.items')
    out.items = v.items.slice(0, DETAIL_ITEMS_MAX).map(item)
  }
  if (v.live !== undefined) out.live = live(v.live, now)
  return out
}

/** @param {unknown} v @param {number} now */
function mergeQueue(v, now) {
  if (!isObj(v)) throw new Invalid('delivery.merge_queue')
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const k of /** @type {const} */ (['position', 'total'])) {
    if (v[k] === undefined) continue
    if (v[k] !== null && !(Number.isSafeInteger(v[k]) && v[k] >= 1)) throw new Invalid(`delivery.merge_queue.${k}`)
    out[k] = v[k]
  }
  const reason = text(v.reason, DETAIL_TEXT_MAX.reason, 'delivery.merge_queue.reason')
  if (reason !== undefined) out.reason = reason
  const since = date(v.since, now, 'delivery.merge_queue.since')
  if (since !== undefined) out.since = since
  return out
}

/** @param {unknown} v @param {number} now */
function deployState(v, now) {
  if (!isObj(v) || !DEPLOY_STATES.includes(v.state)) throw new Invalid('delivery.deploy')
  /** @type {Record<string, unknown>} */
  const out = { state: v.state }
  const at = date(v.at, now, 'delivery.deploy.at')
  if (at !== undefined) out.at = at
  return out
}

/**
 * `delivery.merge_queue` and `delivery.deploy`: a bad one is dropped on its
 * own and the build still goes (as `waiting` does); a missing or null one
 * leaves the build as it was.
 * @param {unknown} delivery the raw delivery block @param {number} now
 * @returns {Record<string, unknown>}
 */
export function deliveryExtras(delivery, now) {
  /** @type {Record<string, unknown>} */
  const out = {}
  if (!isObj(delivery)) return out
  for (const [key, check] of /** @type {const} */ ([['merge_queue', mergeQueue], ['deploy', deployState]])) {
    if (absent(delivery[key])) continue
    try {
      out[key] = check(delivery[key], now)
    } catch (err) {
      if (!(err instanceof Invalid)) throw err
    }
  }
  return out
}

/** The JSON schema of the blocks above for link_build_stage. */
export const DETAIL_SCHEMA = Object.freeze({
  flow: { type: 'string', enum: [...BUILD_FLOWS], description: 'Solo coordinador; full por omisión' },
  stage_detail: {
    type: 'object', additionalProperties: false, required: ['stage'],
    description: 'Solo coordinador; reemplaza el anterior; sin secretos',
    properties: {
      stage: { type: 'integer', minimum: 1, maximum: 7 },
      items: {
        type: 'array', maxItems: DETAIL_ITEMS_MAX, description: 'Evidencia',
        items: {
          type: 'object', additionalProperties: false, required: ['label'],
          properties: {
            label: { type: 'string', description: `Máx. ${DETAIL_TEXT_MAX.label}` },
            value: { type: 'string', description: `Máx. ${DETAIL_TEXT_MAX.value}` },
            href: { type: 'string', description: `https: o ruta relativa (máx. ${BUILD_TEXT_MAX.link})` },
          },
        },
      },
      live: {
        type: ['object', 'null'], additionalProperties: false, required: ['label'],
        description: 'Qué pasa ahora; null lo borra',
        properties: {
          label: { type: 'string', description: `Máx. ${DETAIL_TEXT_MAX.live}` },
          done: { type: 'integer', minimum: 0 },
          total: { type: 'integer', minimum: 0 },
          at: { type: 'string' },
        },
      },
    },
  },
})

/** The schema of `delivery.merge_queue` and `delivery.deploy`. */
export const DELIVERY_EXTRA_SCHEMA = Object.freeze({
  merge_queue: {
    type: 'object', description: 'Un campo inválido lo descarta',
    properties: {
      position: { type: ['integer', 'null'], minimum: 1 }, total: { type: ['integer', 'null'], minimum: 1 },
      reason: { type: 'string', description: `Máx. ${DETAIL_TEXT_MAX.reason}` }, since: { type: 'string' },
    },
  },
  deploy: {
    type: 'object', required: ['state'], description: 'Un campo inválido lo descarta',
    properties: { state: { type: 'string', enum: [...DEPLOY_STATES] }, at: { type: 'string' } },
  },
})
