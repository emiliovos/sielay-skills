// `/link` and its subcommands: status, name, off|on, peers, pair <slot>.

import { normalizeName, cwdHash } from './link-session-name-resolution.js'
import { describeHubError } from './link-tools.js'
import { buildSessionPayload, sessionDir } from './link-session-payload.js'
import { PANE_ID } from './link-state-refs.js'
import { isOff } from './link-runtime.js'
import { resolveStripId, isPersonOrigin, shortId } from './link-strip-selection.js'
import { decideStripItem, showStripItem, oneLine } from './link-band.jsx'
import { ownAddress, selfPrefixOf } from './link-discovery-context.js'

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
  '  /link show <id>     abre el mensaje completo de la franja en el panel',
  '  /link accept <id>   acepta ese mensaje de la franja (solo tecleado por ti)',
  '  /link reject <id>   lo rechaza',
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
    `Estado: ${off ? 'apagado' : (st?.loop ?? 'iniciando')}${st?.detail ? ` (${st.detail})` : ''}`,
    `Hub: ${rt.hubUrl ?? `inválido (${rt.hubError})`} · token: ${rt.tokenSource}`,
    `Dirección: ${st?.address ?? '(sin asignar)'} · nombre: ${built.session.name} (${built.nameSource})`,
    `Modo: ${mode.mode} (${mode.fresh ? 'fresco' : 'no fresco'}, visto ${ago(mode.ageMs)}) · estado: ${mode.state}`,
    `Entrega: ${rt.adapter?.mode ?? '—'} · en franja: ${strip.length}`,
  ].join('\n')
}

/**
 * @param {Engine} $ @param {Runtime} rt @param {string} args
 * @param {unknown} origin the command's PromptOrigin: deciding needs the person's own Enter
 * @returns {Promise<{ text: string }>}
 */
export async function runLinkCommand($, rt, args, origin) {
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
    await $.store.set(`name.${await cwdHash(await sessionDir($))}`, name)
    return { text: `Nombre de la sesión para esta carpeta: ${name}. El hub lo toma en el siguiente poll.` }
  }
  if (sub === 'off' || sub === 'on') {
    await $.state.set(OFF, sub === 'off')
    return { text: sub === 'off' ? 'sielay-link apagado en esta sesión (deja de recibir).' : 'sielay-link encendido en esta sesión.' }
  }
  if (sub === 'peers') {
    if (!rt.client) return { text: 'Sin emparejar: corre /link pair <slot>.' }
    try {
      const answer = await rt.client.peers()
      const peers = Array.isArray(answer?.peers) ? answer.peers : []
      const prefix = selfPrefixOf(answer)
      if (prefix) rt.addressPrefix = prefix
      const own = await ownAddress({
        address: (await $.state.get(STATUS)).value?.address,
        addressPrefix: prefix,
        sessionName: async () => (await buildSessionPayload($, rt)).session.name,
      })
      const head = `Tu dirección: ${own ?? '(sin asignar)'}`
      if (!peers.length) return { text: `${head}\nNo tienes pares todavía. Un admin los crea en el dashboard.` }
      /** @param {{ address: string, online?: boolean, mode?: string, state?: string, project?: string|null }} p */
      const line = p => `${p.online ? '●' : '○'} ${oneLine(p.address, 120)}  ${oneLine(p.mode ?? '?', 30)} · ${oneLine(p.state ?? '?', 20)}${p.project ? ` · ${oneLine(p.project, 80)}` : ''}`
      return { text: [head, ...peers.map(line)].join('\n') }
    } catch (err) {
      return { text: describeHubError(err) }
    }
  }
  if (sub === 'show' || sub === 'accept' || sub === 'reject') {
    const { value: strip = [] } = await $.state.get(STRIP)
    const found = resolveStripId(strip, arg)
    if (!found.id) return { text: found.error ?? 'No encontrado.' }
    if (sub === 'show') {
      await showStripItem($, found.id)
      return { text: `Mensaje ${shortId(found.id)} abierto en el panel.` }
    }
    if (!isPersonOrigin(origin)) {
      return { text: 'Solo la persona en esta terminal puede aceptar o rechazar, tecleando el comando.' }
    }
    const r = await decideStripItem($, rt, found.id, sub)
    return { text: r.ok ? `Mensaje ${shortId(found.id)} ${sub === 'accept' ? 'aceptado y entregado' : 'rechazado'}.` : String(r.error) }
  }
  if (sub === 'pair') {
    if (!rt.pairing) return { text: `sielay-link no arrancó: ${rt.hubError ?? 'revisa /link'}` }
    return { text: (await rt.pairing.start(arg)).text }
  }
  return { text: HELP }
}
