// link_build_stage: the one tool through which /si:build-auto tells sielay how
// its build is going. It only reports: it controls nothing, approves nothing
// and starts nothing. Pure (no `$`): the mod passes in how to store the build
// and whether this session reports to a hub right now.

import { BUILD_STAGES, BUILD_STATUSES, BUILD_ROLES } from './link-build-validate.js'

const str = (/** @type {string} */ description) => ({ type: 'string', description })

export const BUILD_TOOL_SPEC = Object.freeze({
  name: 'link_build_stage',
  description:
    'Solo informa a sielay en qué va el build de /si:build-auto de esta sesión (etapa, estado, resumen, entrega); ' +
    'no controla nada: no aprueba etapas, no mergea ni dispara acciones. El hub lo recibe en el siguiente poll (≤ 25 s). ' +
    'Cada llamada mezcla sus campos con los del mismo build_id; un build_id nuevo empieza otro build. Los subagentes, ' +
    'el uso de tokens y started_at los pone el plugin. Responde reported:false si esta sesión no está emparejada o ' +
    'sielay-link está apagado (el estado se guarda igual).',
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
        type: 'object', additionalProperties: false,
        properties: { stage: { type: 'integer', minimum: 1, maximum: BUILD_STAGES.length }, approved_by: str('Quién aprobó'), approved_at: str('ISO 8601') },
      },
      summary: str('Resumen corto de la etapa (máximo 600); nunca secretos'),
      delivery: {
        type: 'object', additionalProperties: false,
        properties: {
          merge_pr: { type: ['string', 'null'], enum: ['pending', 'running', 'merged', 'failed', null] },
          stamp: { type: ['string', 'null'], description: 'SHA del sello (7 a 40 hex)' },
          deploy_pending: { type: 'boolean' },
        },
      },
      linear: str('Issue de Linear, p. ej. VOS-260'),
      links: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['href'], properties: { label: { type: 'string' }, href: str('Ruta relativa o URL https:') } },
      },
      stage_since: str('ISO 8601; si falta, el plugin la pone al cambiar de etapa'),
    },
  },
  isDeferred: /** @type {const} */ (false),
})

/**
 * @typedef {{
 *   declare: (input: Record<string, unknown>) => Promise<{ error?: string }>,
 *   canReport: () => Promise<boolean>,
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
  return { result: JSON.stringify({ ok: true, reported: await deps.canReport() }) }
}
