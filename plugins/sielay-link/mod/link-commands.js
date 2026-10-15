// `/link` and its subcommands: status, name, off|on, peers, pair <slot>.

import { normalizeName, cwdHash } from './link-session-name-resolution.js'
import { describeHubError } from './link-tools.js'
import { buildSessionPayload } from './link-session-payload.js'
import { PANE_ID } from './link-state-refs.js'
import { isOff } from './link-runtime.js'

// $.state references: literal plugin/key, declared in each file that uses them.
const OFF = /** @type {const} */ ({ plugin: 'sielay-link', key: 'off' })
const STATUS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'status' })
const STRIP = /** @type {const} */ ({ plugin: 'sielay-link', key: 'strip' })

const HELP = [
  'Uso:',
  '  /link               estado de esta sesión (abre el panel)',
  '  /link name <nombre> fija el nombre de la sesión para esta carpeta',
  '  /link off | on      apaga o enciende sielay-link en esta sesión',
  '  /link peers         sesiones con las que puedes hablar',
  '  /link pair <slot>   empareja esta máquina (el slot lo crea un admin)',
].join('\n')

/** @typedef {import('claude-code').EngineInterface} Engine */
/** @typedef {import('./link-runtime.js').Runtime} Runtime */

/** @param {number|null} ms */
function ago(ms) {
  if (ms === null) return 'nunca'
  const s = Math.floor(ms / 1000)
  return s < 90 ? `hace ${s} s` : s < 5400 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`
}

/** @param {Engine} $ @param {Runtime} rt */
async function statusText($, rt) {
  const [{ value: st }, { value: strip = [] }, built, off] = await Promise.all([
    $.state.get(STATUS),
    $.state.get(STRIP),
    buildSessionPayload($, rt),
    isOff($),
  ])
  const mode = built.mode
  return [
    `sielay-link ${off ? '(apagado)' : `— ${st?.loop ?? 'iniciando'}`}${st?.detail ? `: ${st.detail}` : ''}`,
    `Hub: ${rt.hubUrl ?? `inválido (${rt.hubError})`} · token: ${rt.tokenSource}`,
    `Dirección: ${st?.address ?? '(sin asignar)'} · nombre: ${built.session.name} (${built.nameSource})`,
    `Modo: ${mode.mode} (${mode.fresh ? 'fresco' : 'no fresco'}, visto ${ago(mode.ageMs)}) · estado: ${mode.state}`,
    `Entrega: ${rt.adapter?.mode ?? '—'} · en franja: ${strip.length}`,
  ].join('\n')
}

/**
 * @param {Engine} $ @param {Runtime} rt @param {string} args
 * @returns {Promise<{ text: string }>}
 */
export async function runLinkCommand($, rt, args) {
  const [sub = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const arg = rest.join(' ')

  if (sub === '' || sub === 'status') {
    try {
      await $.ui.open({ id: PANE_ID, title: 'sielay-link' })
    } catch {
      // no pane on this surface: the text below is enough
    }
    return { text: await statusText($, rt) }
  }
  if (sub === 'name') {
    const name = normalizeName(arg)
    if (!name) return { text: 'Uso: /link name <nombre> (minúsculas, números y guiones, hasta 40).' }
    await $.store.set(`name.${await cwdHash(await $.session.cwd())}`, name)
    return { text: `Nombre de la sesión para esta carpeta: ${name}. El hub lo toma en el siguiente poll.` }
  }
  if (sub === 'off' || sub === 'on') {
    await $.state.set(OFF, sub === 'off')
    return { text: sub === 'off' ? 'sielay-link apagado en esta sesión (deja de recibir).' : 'sielay-link encendido en esta sesión.' }
  }
  if (sub === 'peers') {
    if (!rt.client) return { text: 'Sin emparejar: corre /link pair <slot>.' }
    try {
      const { peers = [] } = await rt.client.peers()
      if (!peers.length) return { text: 'No tienes pares todavía. Un admin los crea en el dashboard.' }
      /** @param {{ address: string, online?: boolean, mode?: string, state?: string, project?: string|null }} p */
      const line = p => `${p.online ? '●' : '○'} ${p.address}  ${p.mode ?? '?'} · ${p.state ?? '?'}${p.project ? ` · ${p.project}` : ''}`
      return { text: peers.map(line).join('\n') }
    } catch (err) {
      return { text: describeHubError(err) }
    }
  }
  if (sub === 'pair') {
    if (!rt.pairing) return { text: `sielay-link no arrancó: ${rt.hubError ?? 'revisa /link'}` }
    return { text: (await rt.pairing.start(arg)).text }
  }
  return { text: HELP }
}
