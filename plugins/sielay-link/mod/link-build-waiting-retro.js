// The two blocks of a build that say what it waits for and how it went
// (sielay contracts «te espera» and «reporte de cierre» §3): `waiting` and
// `retro`. Mirrors the hub's checks, never looser. Pure.

import { Invalid, isObj, absent, text, safeHref, BUILD_TEXT_MAX } from './link-build-fields.js'

export const WAITING_ON = Object.freeze(['you', 'terminal', 'pr', 'ci', 'external', 'error'])
export const RETRO_KINDS = Object.freeze(['ui', 'backend', 'infra', 'docs', 'mixed'])
export const RETRO_APPLIES_TO = Object.freeze(['build-auto', 'repo', 'plan'])
export const WAITING_TEXT_MAX = Object.freeze({ who: 120, what: 160, next: 160 })
export const RETRO_TEXT_MAX = 160
export const RETRO_LIST_MAX = 5
export const RETRO_PROPOSALS_MAX = 4

/**
 * `https:` or a path on the hub that starts with one `/` (`/builds/x`); never
 * `//host` or `/\`, which a browser reads as another host. Null drops it.
 * @param {unknown} href
 */
function waitingHref(href) {
  if (typeof href !== 'string') return null
  const h = href.trim()
  if (/^\/(?![/\\])/.test(h)) return h.length > 1 && safeHref(h.slice(1)) !== null ? h : null
  return /^https:/i.test(h) ? safeHref(h) : null
}

/**
 * What the build waits for: `null` clears it, absent leaves it as it was.
 * A bad `on` refuses the build; a bad href is dropped.
 * @param {unknown} v
 */
export function waiting(v) {
  if (v === undefined) return undefined
  if (v === null) return null
  if (!isObj(v)) throw new Invalid('waiting')
  if (!WAITING_ON.includes(v.on)) throw new Invalid('waiting.on')
  /** @type {Record<string, unknown>} */
  const out = { on: v.on }
  for (const k of /** @type {const} */ (['who', 'what', 'next'])) {
    const t = text(v[k], WAITING_TEXT_MAX[k], `waiting.${k}`)
    if (t !== undefined) out[k] = t
  }
  const href = absent(v.href) ? null : waitingHref(v.href)
  if (href) out.href = href
  return out
}

/** @param {unknown} v @param {string} field */
function list(v, field) {
  if (absent(v)) return []
  if (!Array.isArray(v)) throw new Invalid(field)
  return v.map(t => text(t, RETRO_TEXT_MAX, field)).filter(t => t !== undefined).slice(0, RETRO_LIST_MAX)
}

/**
 * How the build went, only with `status: done` (otherwise left out). A bad
 * `kind` becomes null, as the hub keeps it; long lists are cut, not refused.
 * @param {unknown} v @param {unknown} status
 */
export function retro(v, status) {
  if (absent(v) || status !== 'done') return undefined
  if (!isObj(v)) throw new Invalid('retro')
  if (!absent(v.propuestas) && !Array.isArray(v.propuestas)) throw new Invalid('retro.propuestas')
  const propuestas = (Array.isArray(v.propuestas) ? v.propuestas : []).flatMap(p => {
    const t = isObj(p) ? text(p.text, RETRO_TEXT_MAX, 'retro.propuestas.text') : undefined
    if (t === undefined) return []
    return [RETRO_APPLIES_TO.includes(p.applies_to) ? { text: t, applies_to: p.applies_to } : { text: t }]
  }).slice(0, RETRO_PROPOSALS_MAX)
  return {
    kind: RETRO_KINDS.includes(v.kind) ? v.kind : null,
    bien: list(v.bien, 'retro.bien'),
    mal: list(v.mal, 'retro.mal'),
    batallo: list(v.batallo, 'retro.batallo'),
    entregado: list(v.entregado, 'retro.entregado'),
    pendientes: list(v.pendientes, 'retro.pendientes'),
    propuestas,
  }
}

/** The JSON schema of both blocks for link_build_stage. */
export const WAITING_RETRO_SCHEMA = Object.freeze({
  waiting: {
    type: ['object', 'null'], additionalProperties: false, required: ['on'],
    description: 'Con blocked o waiting_approval; null, running o done lo borran',
    properties: {
      on: { type: 'string', enum: [...WAITING_ON], description: 'you: la persona; error: falla' },
      who: { type: 'string', description: `Link, PR o nombre (máx. ${WAITING_TEXT_MAX.who})` },
      what: { type: 'string', description: `Máx. ${WAITING_TEXT_MAX.what}` },
      next: { type: 'string', description: `Al resolverse (máx. ${WAITING_TEXT_MAX.next})` },
      href: { type: 'string', description: `https: o ruta con / (máx. ${BUILD_TEXT_MAX.link})` },
    },
  },
  retro: {
    type: 'object', additionalProperties: false,
    description: 'Solo con done: reporte de cierre',
    properties: {
      kind: { type: 'string', enum: [...RETRO_KINDS] },
      bien: { type: 'array', maxItems: RETRO_LIST_MAX, items: { type: 'string' }, description: `Máx. ${RETRO_TEXT_MAX} c/u` },
      mal: { type: 'array', maxItems: RETRO_LIST_MAX, items: { type: 'string' } },
      batallo: { type: 'array', maxItems: RETRO_LIST_MAX, items: { type: 'string' } },
      entregado: { type: 'array', maxItems: RETRO_LIST_MAX, items: { type: 'string' }, description: 'PRs, versiones, cambios visibles' },
      pendientes: { type: 'array', maxItems: RETRO_LIST_MAX, items: { type: 'string' }, description: 'Y de quién' },
      propuestas: {
        type: 'array', maxItems: RETRO_PROPOSALS_MAX,
        items: {
          type: 'object', additionalProperties: false, required: ['text'],
          properties: { text: { type: 'string' }, applies_to: { type: 'string', enum: [...RETRO_APPLIES_TO] } },
        },
      },
    },
  },
})
