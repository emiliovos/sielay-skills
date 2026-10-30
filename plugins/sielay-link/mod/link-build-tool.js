// link_build_stage: the one tool through which /si:build-auto tells sielay how
// its build is going. It only reports: it controls nothing, approves nothing
// and starts nothing. Pure (no `$`): the mod passes in how to store the build
// and whether the hub is taking this session's polls right now (reportState).

import { BUILD_STAGES, BUILD_STATUSES, BUILD_ROLES, BUILD_TEXT_MAX } from './link-build-validate.js'
import { BUILD_ESTIMATE_PHASES_MAX, BUILD_ESTIMATE_H_MAX } from './link-build-fields.js'
import { WAITING_RETRO_SCHEMA } from './link-build-waiting-retro.js'
import { DETAIL_SCHEMA, DELIVERY_EXTRA_SCHEMA } from './link-build-detail.js'

const str = (/** @type {string} */ description) => ({ type: 'string', description })

export const BUILD_TOOL_SPEC = Object.freeze({
  name: 'link_build_stage',
  description:
    'Solo informa a sielay en qué va el build de /si:build-auto (etapa, estado, resumen, entrega); no controla nada. ' +
    'Cada llamada mezcla sus campos con los del mismo build_id. reported:true significa que el hub acepta los polls de ' +
    'esta sesión, no que registró el build; con reported:false, reason dice por qué. No reintentes: lo lleva el siguiente poll.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['build_id', 'role', 'stage', 'status'],
    properties: {
      build_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{2,79}$', description: '<repo>-<carpeta-del-plan>; -r2… en otra corrida' },
      role: { type: 'string', enum: [...BUILD_ROLES], description: 'coordinator: etapa y estado; worker: solo su fase' },
      stage: { type: 'integer', minimum: 1, maximum: BUILD_STAGES.length, description: `Etapa 1..7: ${BUILD_STAGES.join(', ')}` },
      status: { type: 'string', enum: [...BUILD_STATUSES] },
      outcome: { type: 'string', enum: ['delivered', 'stopped', 'failed'], description: 'Solo con done' },
      title: str('Máx. 120'),
      repo: str('owner/repo'),
      plan: str('Ruta del plan.md'),
      branch: { type: 'string' },
      pr: { type: ['integer', 'null'], minimum: 1 },
      flags: { type: 'array', items: { type: 'string' } },
      plan_progress: {
        type: 'object', additionalProperties: false, required: ['done', 'total'],
        properties: { done: { type: 'integer', minimum: 0 }, total: { type: 'integer', minimum: 0 } },
      },
      phase: { type: 'string' },
      gate: {
        type: 'object', additionalProperties: false, required: ['stage'],
        properties: { stage: { type: 'integer', minimum: 1, maximum: BUILD_STAGES.length }, approved_by: { type: 'string' }, approved_at: str('ISO 8601') },
      },
      summary: str('Máx. 600; sin secretos'),
      delivery: {
        type: 'object', additionalProperties: false,
        properties: {
          merge_pr: { type: ['string', 'null'], enum: ['pending', 'running', 'merged', 'failed', null] },
          stamp: { type: ['string', 'null'], description: 'SHA del sello' },
          deploy_pending: { type: 'boolean' },
          ...DELIVERY_EXTRA_SCHEMA,
        },
      },
      linear: str('p. ej. VOS-260'),
      links: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['href'], properties: { label: { type: 'string' }, href: str('https: o ruta relativa') } },
      },
      stage_since: str('ISO 8601; si falta, la pone el plugin'),
      estimate: {
        type: ['object', 'null'], additionalProperties: false, required: ['total_h'],
        description: 'Horas de reloj, solo coordinador: reemplaza al anterior entero; null lo deja igual',
        properties: {
          total_h: { type: 'number', exclusiveMinimum: 0, maximum: BUILD_ESTIMATE_H_MAX },
          phases: {
            type: 'array', maxItems: BUILD_ESTIMATE_PHASES_MAX,
            items: {
              type: 'object', additionalProperties: false, required: ['name', 'h'],
              properties: { name: str(`Máx. ${BUILD_TEXT_MAX.phase}`), h: { type: 'number', minimum: 0, maximum: BUILD_ESTIMATE_H_MAX } },
            },
          },
          assumption: str(`Supuesto (máx. ${BUILD_TEXT_MAX.assumption})`),
          reason: str(`Por qué se reestima (máx. ${BUILD_TEXT_MAX.reason})`),
        },
      },
      ...WAITING_RETRO_SCHEMA,
      ...DETAIL_SCHEMA,
    },
  },
  isDeferred: /** @type {const} */ (false),
})

/** Every `reason` link_build_stage can answer with (the frozen table of the contract). */
export const REPORT_REASONS = Object.freeze(['pending', 'too_many_sessions', 'paused', 'unauthorized', 'unpaired', 'off', 'unreachable'])

/** @typedef {{ reported: true, reason?: undefined } | { reported: false, reason: string }} ReportState */

/**
 * Whether the hub is taking this session's polls, from what is true right now
 * (off, paired) and the poll loop's last code (null before the first poll).
 * @param {{ paired: boolean, off: boolean, code: import('./link-poll-loop.js').LoopCode|null|undefined }} input
 * @returns {ReportState}
 */
export function reportState({ paired, off, code }) {
  if (off) return { reported: false, reason: 'off' }
  if (!paired) return { reported: false, reason: 'unpaired' }
  // null before the first poll; off/unpaired that no longer hold wait for the next poll
  if (code === null || code === undefined || code === 'off' || code === 'unpaired') return { reported: false, reason: 'pending' }
  if (code === 'online') return { reported: true }
  return { reported: false, reason: REPORT_REASONS.includes(code) ? code : 'unreachable' }
}

/**
 * @typedef {{
 *   declare: (input: Record<string, unknown>) => Promise<{ error?: string }>,
 *   canReport: () => Promise<ReportState>,
 * }} BuildToolDeps
 */

/**
 * @param {Record<string, unknown>} input
 * @param {BuildToolDeps} deps
 * @returns {Promise<{ deny: string, result?: undefined } | { result: string, deny?: undefined }>}
 */
export async function runBuildTool(input, deps) {
  const { error } = await deps.declare(input ?? {})
  if (error) return { deny: `link_build_stage: el campo ${error} no es válido; no se guardó ni se envía nada.` }
  const { reported, reason } = await deps.canReport()
  return { result: JSON.stringify(reported ? { ok: true, reported } : { ok: true, reported, reason }) }
}
