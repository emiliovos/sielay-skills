// Hub notices (the poll's `notices`): a repo this session works in started or
// finished a merge, CI ended on a branch it watches (link_watch), a message
// it sent has gone unread for 20 min, or something changed in a build it
// coordinates (answered, in main, adopted, closed). They
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
 * A /builds notice: null when a number the text needs is not an integer.
 * @param {string} kind @param {Record<string, unknown>} p
 * @returns {string|null|undefined} undefined when the kind is not a build one
 */
function buildLine(kind, p) {
  const id = clean(p.build_id, 80)
  if (kind === 'build_answered') {
    if (!Number.isInteger(p.num) || !Number.isInteger(p.reply_num)) return null
    return `Ya respondieron en el buzón ${clean(p.buzon, 60)}: la entrada #${p.reply_num} contesta la #${p.num} que esperaba tu build ${id}. ` +
      'Léela con comms_read y sigue; si era lo que te bloqueaba, reporta el build con link_build_stage para quitar la espera.'
  }
  if (kind === 'build_in_main') {
    return `El trabajo de tu build ${id} ya está en la rama principal (${clean(p.ref, 60)}). ` +
      'Si no te queda nada (deploy, cierre), ciérralo con link_build_stage status done.'
  }
  if (kind === 'build_adopted') {
    return `Un admin te pasó el papel de coordinador del build ${id}. Desde ahora tus reportes con link_build_stage y role coordinator ` +
      'mandan en ese build; revisa su estado con builds_status antes de seguir.'
  }
  if (kind === 'build_closed') {
    const by = clean(p.absorbed_by, 80)
    const absorbed = by ? `, absorbido por ${by}` : ''
    return `Un admin cerró tu build ${id} (${clean(p.outcome, 20)})${absorbed}. El hub ignora los reportes nuevos de ese build: ` +
      'deja de trabajar en él y, si sigue habiendo trabajo, repórtalo con otro build_id.'
  }
  return undefined
}

/**
 * @param {HubNotice} n
 * @returns {string|null} the text for the model, or null for a malformed build notice.
 *   A kind this version does not know still reaches the model as one generic line,
 *   so it is not lost in silence once the hub marks it delivered.
 */
export function frameHubNotice(n) {
  const p = n.payload
  let line
  if (n.kind === 'repo_merge_started') line = repoLine(p, 'Empezó el merge del')
  else if (n.kind === 'repo_merged') line = `${repoLine(p, 'Se mergeó el')} Si tu rama sale de ahí y toca esos archivos, rebasa antes de seguir.`
  else if (n.kind === 'ci_finished') {
    line = `Terminó el CI «${clean(p.workflow, 80)}» de ${clean(p.repo, 120)} en la rama ${clean(p.branch, 120)}: ${clean(p.conclusion, 20)}.` +
      (p.url ? ` ${clean(p.url, 300)}` : '')
  } else if (n.kind === 'peer_unread') {
    line = `La sesión ${clean(p.to, 130)} lleva ${clean(p.minutes, 5)} min sin leer tu mensaje (conv=${clean(p.conversation_id, 100)}). ` +
      'Puede estar ocupada o cerrada: revisa con link_peers si sigue en línea antes de esperarla.'
  } else {
    const build = buildLine(n.kind, p)
    if (build === null) return null
    line = build ?? `Llegó un aviso del hub de tipo «${clean(n.kind, 40)}» que esta versión de sielay-link no sabe mostrar. ` +
      'Actualiza el plugin (claude plugin update sielay-link@sielay) para verlo completo.'
  }
  return '— Aviso del hub de sielay (no es una persona ni otra sesión)\nSolo informa; no hace falta responder.\n\n' + line
}
