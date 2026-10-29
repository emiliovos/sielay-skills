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
    'Solo informa a sielay en qué va el build de /si:build-auto de esta sesión (etapa, estado, resumen, entrega); ' +
    'no controla nada: no aprueba etapas, no mergea ni dispara acciones. El hub lo recibe en el siguiente poll (≤ 25 s). ' +
    'Cada llamada mezcla sus campos con los del mismo build_id; un build_id nuevo empieza otro build. Los subagentes, ' +
    'el uso de tokens y started_at los pone el plugin. El build se guarda siempre. reported:true significa que el hub acepta ' +
    'los polls de esta sesión, no que registró el build (puede ignorarlo por su tope de builds, un build cerrado o el visor ' +
    'apagado). Con reported:false, el campo reason dice por qué: pending (aún no hubo poll), too_many_sessions (la máquina ' +
    'llegó a su tope de sesiones: 16 en línea o 200 nuevas en 7 días), paused, unauthorized, unpaired, off o unreachable (red o hub caído). ' +
    'No reintentes por eso: el siguiente poll lo lleva si la sesión vuelve a estar en línea.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['build_id', 'role', 'stage', 'status'],
    properties: {
      build_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{2,79}$', description: '<repo>-<carpeta-del-plan>, con -r2, -r3… en una segunda corrida' },
      role: { type: 'string', enum: [...BUILD_ROLES], description: 'coordinator manda etapa y estado; worker solo aporta su fase' },
      stage: { type: 'integer', minimum: 1, maximum: BUILD_STAGES.length, description: `Etapa 1..7: ${BUILD_STAGES.join(', ')}` },
      status: { type: 'string', enum: [...BUILD_STATUSES] },
      outcome: { type: 'string', enum: ['delivered', 'stopped', 'failed'], description: 'Solo con status done' },
      title: str('Título del build (máximo 120)'),
      repo: str('owner/repo'),
      plan: str('Ruta del plan.md'),
      branch: str('Rama de trabajo'),
      pr: { type: ['integer', 'null'], minimum: 1, description: 'Número del PR' },
      flags: { type: 'array', items: { type: 'string' }, description: 'Banderas de la corrida' },
      plan_progress: {
        type: 'object', additionalProperties: false, required: ['done', 'total'],
        properties: { done: { type: 'integer', minimum: 0 }, total: { type: 'integer', minimum: 0 } },
      },
      phase: str('Fase en curso (worker o coordinador)'),
      gate: {
        type: 'object', additionalProperties: false, required: ['stage'],
        properties: { stage: { type: 'integer', minimum: 1, maximum: BUILD_STAGES.length }, approved_by: str('Quién aprobó'), approved_at: str('ISO 8601') },
      },
      summary: str('Resumen corto de la etapa (máximo 600); nunca secretos'),
      delivery: {
        type: 'object', additionalProperties: false,
        properties: {
          merge_pr: { type: ['string', 'null'], enum: ['pending', 'running', 'merged', 'failed', null] },
          stamp: { type: ['string', 'null'], description: 'SHA del sello (7 a 40 hex)' },
          deploy_pending: { type: 'boolean' },
          ...DELIVERY_EXTRA_SCHEMA,
        },
      },
      linear: str('Issue de Linear, p. ej. VOS-260'),
      links: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['href'], properties: { label: { type: 'string' }, href: str('Ruta relativa o URL https:') } },
      },
      stage_since: str('ISO 8601; si falta, el plugin la pone al cambiar de etapa'),
      estimate: {
        type: ['object', 'null'], additionalProperties: false, required: ['total_h'],
        description: 'Estimado completo en horas de reloj (solo el coordinador): reemplaza al anterior entero; null o ausente lo deja como estaba',
        properties: {
          total_h: { type: 'number', exclusiveMinimum: 0, maximum: BUILD_ESTIMATE_H_MAX, description: 'Horas totales; se redondea a 0,1' },
          phases: {
            type: 'array', maxItems: BUILD_ESTIMATE_PHASES_MAX, description: 'Desglose por fase',
            items: {
              type: 'object', additionalProperties: false, required: ['name', 'h'],
              properties: { name: str(`Nombre de la fase (máximo ${BUILD_TEXT_MAX.phase})`), h: { type: 'number', minimum: 0, maximum: BUILD_ESTIMATE_H_MAX, description: 'Horas; se redondea a 0,1' } },
            },
          },
          assumption: str(`Supuesto del que depende el estimado (máximo ${BUILD_TEXT_MAX.assumption})`),
          reason: str(`Motivo de la reestimación (máximo ${BUILD_TEXT_MAX.reason})`),
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
