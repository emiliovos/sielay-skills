// Hub notices (the poll's `notices`): a repo this session works in started or
// finished a merge, or CI ended on a branch it watches (link_watch). They
// reach the model as a short card that says it is the hub, not a person nor
// another session. Every value is the hub's, already validated there, and is
// still neutralized here. Pure.

import { neutralizeBody } from './link-inbound-framing.js'

/** @param {unknown} v @param {number} [max] */
const clean = (v, max = 200) => neutralizeBody(typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * @typedef {{ id: string, kind: string, payload: Record<string, unknown>, created_at?: string }} HubNotice
 */

/**
 * True for a notice the client can show.
 * @param {unknown} n
 * @returns {n is HubNotice}
 */
export function isHubNotice(n) {
  if (n === null || typeof n !== 'object') return false
  const o = /** @type {Record<string, unknown>} */ (n)
  return typeof o.id === 'string' && typeof o.kind === 'string' && o.payload !== null && typeof o.payload === 'object'
}

/** @param {Record<string, unknown>} p @param {string} verb */
function repoLine(p, verb) {
  const files = Array.isArray(p.files) ? p.files.map(f => clean(f, 120)).filter(Boolean) : []
  const total = Number.isInteger(p.files_total) ? /** @type {number} */ (p.files_total) : files.length
  const sha = p.sha ? ` (${clean(p.sha, 12)})` : ''
  const list = files.length ? ` Archivos: ${files.slice(0, 10).join(', ')}${total > 10 ? ` y ${total - 10} más` : ''}.` : ''
  return `${verb} PR #${clean(p.pr, 10)} en ${clean(p.repo, 120)}${sha}.${list}`
}

/**
 * @param {HubNotice} n
 * @returns {string|null} the text for the model, or null for an unknown kind
 */
export function frameHubNotice(n) {
  const p = n.payload
  let line
  if (n.kind === 'repo_merge_started') line = repoLine(p, 'Empezó el merge del')
  else if (n.kind === 'repo_merged') line = `${repoLine(p, 'Se mergeó el')} Si tu rama sale de ahí y toca esos archivos, rebasa antes de seguir.`
  else if (n.kind === 'ci_finished') {
    line = `Terminó el CI «${clean(p.workflow, 80)}» de ${clean(p.repo, 120)} en la rama ${clean(p.branch, 120)}: ${clean(p.conclusion, 20)}.` +
      (p.url ? ` ${clean(p.url, 300)}` : '')
  } else return null
  return '— Aviso del hub de sielay (no es una persona ni otra sesión)\nSolo informa; no hace falta responder.\n\n' + line
}
