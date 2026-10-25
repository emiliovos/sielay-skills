// link_watch: this session asks the hub to tell it when CI ends on a branch
// (the hub reads the runs of the pve2 CI photo). The notice arrives later as
// a hub card in the poll (link-hub-notice-framing.js). Only admins may watch;
// the hub answers 403 otherwise. Pure (no `$`).

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/

export const WATCH_TOOL_SPEC = Object.freeze({
  name: 'link_watch',
  description:
    'Pide al hub de sielay que te avise cuando termine el CI (sielay-ci en pve2) de una rama. El aviso llega solo, más tarde, ' +
    'como «Aviso del hub de sielay»; no hace falta esperar ni consultar. Úsala después de empujar una rama. Dura 24 h (ttl_h hasta 72); ' +
    'off: true lo quita. repo por omisión: el de esta sesión (su remoto origin de GitHub). Solo para admins.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['branch'],
    properties: {
      branch: { type: 'string', description: 'Rama a vigilar' },
      repo: { type: 'string', description: 'owner/repo; por omisión el de esta sesión' },
      ttl_h: { type: 'integer', minimum: 1, maximum: 72, description: 'Horas que dura el aviso (24 por omisión)' },
      off: { type: 'boolean', description: 'true deja de vigilar esa rama' },
    },
  },
  isDeferred: /** @type {const} */ (false),
})

/**
 * @typedef {{
 *   watch: (body: object) => Promise<any>,
 *   session: () => Promise<Record<string, unknown>>,
 *   sessionRepo: () => Promise<string|null|undefined>,
 * }} WatchDeps
 */

/**
 * @param {Record<string, unknown>} input
 * @param {WatchDeps} deps
 * @returns {Promise<{ body: object, error?: undefined } | { error: string, body?: undefined }>}
 */
export async function watchBody(input, deps) {
  const repo = input.repo === undefined ? await deps.sessionRepo() : input.repo
  if (typeof repo !== 'string' || !REPO.test(repo)) return { error: 'No sé el repo de esta sesión: pásalo como repo (owner/repo).' }
  if (typeof input.branch !== 'string' || !BRANCH.test(input.branch) || input.branch.includes('..')) return { error: 'branch no es una rama válida.' }
  if (input.ttl_h !== undefined && !(Number.isInteger(input.ttl_h) && /** @type {number} */ (input.ttl_h) >= 1 && /** @type {number} */ (input.ttl_h) <= 72)) {
    return { error: 'ttl_h va de 1 a 72.' }
  }
  return {
    body: {
      session: await deps.session(), repo, branch: input.branch,
      ...(input.ttl_h !== undefined ? { ttl_h: input.ttl_h } : {}),
      ...(input.off === true ? { off: true } : {}),
    },
  }
}
