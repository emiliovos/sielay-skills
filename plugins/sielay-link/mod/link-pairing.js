// `/link pair <slot>`: device-code pairing against a slot an admin created.
// Pure (no `$`): the mod injects the client, timer, view writer and the
// token-file writer.
//
// Token handling (the token is shown once, so it must never be lost):
// 1. the token is put on screen (pane view) FIRST;
// 2. then written to a 0600 file by the adapter (stdin, never argv);
// 3. once written it leaves the view at once ($.state is readable by any
//    plugin, so it is only there while it has to be);
// 4. if the write fails it stays on screen with the `/plugin` paste
//    fallback for TOKEN_SHOWN_MS, then leaves the view too.
// It is never written to `$.store` or to a plain config field.

export const SLOT_PATTERN = /^[a-z0-9-]{1,60}$/
/** How long a token that could not be saved stays on screen for copying. */
export const TOKEN_SHOWN_MS = 5 * 60_000

/**
 * @typedef {{ phase: 'waiting', slot: string, user_code: string, verification_uri?: string, expires_at: number }
 *   | { phase: 'done', slot: string, token?: string, address_prefix?: string, saved: 'saving'|'file'|'failed', note: string }
 *   | { phase: 'error', slot: string, message: string }} PairingView
 */

/**
 * @param {{
 *   makeClient: () => { origin: string, pairStart: (b: { slot: string, hostname?: string, client_version?: string }) => Promise<any>, pairPoll: (b: { device_code: string }) => Promise<any> },
 *   schedule: (ms: number, fn: () => void) => void,
 *   now: () => Promise<number>,
 *   setView: (view: PairingView) => Promise<void>,
 *   writeTokenFile: (token: string) => Promise<void>,
 *   onToken: (token: string, info: { address_prefix?: string, hub_url?: string }) => Promise<void>,
 *   hostname: () => Promise<string|undefined>,
 *   clientVersion: string,
 *   tokenPath: string,
 * }} deps
 */
export function createPairingFlow(deps) {
  let generation = 0

  /**
   * @param {string} slot
   * @returns {Promise<{ ok: boolean, text: string }>}
   */
  async function start(slot) {
    if (!SLOT_PATTERN.test(slot)) {
      return { ok: false, text: 'Uso: /link pair <slot>. El slot (minúsculas, números y guiones) lo crea un admin en el dashboard.' }
    }
    generation += 1
    const gen = generation
    const client = deps.makeClient()
    /** @type {any} */
    let started
    try {
      started = await client.pairStart({ slot, hostname: await deps.hostname(), client_version: deps.clientVersion })
    } catch (err) {
      const e = /** @type {{ status?: number, message?: string }} */ (err ?? {})
      const text = e.status === 404 ? `El slot "${slot}" no existe o ya se usó. Pide a un admin que lo cree.` : `No se pudo iniciar el emparejamiento: ${e.message ?? String(err)}`
      await deps.setView({ phase: 'error', slot, message: text })
      return { ok: false, text }
    }
    const deviceCode = String(started?.device_code ?? '')
    const userCode = String(started?.user_code ?? '')
    if (!deviceCode || !userCode) {
      const text = 'El hub respondió sin código de emparejamiento.'
      await deps.setView({ phase: 'error', slot, message: text })
      return { ok: false, text }
    }
    const uri = typeof started.verification_uri === 'string' && started.verification_uri.startsWith(`${client.origin}/`) ? started.verification_uri : undefined
    const expiresAt = (await deps.now()) + Math.max(60, Math.min(Number(started.expires_in) || 600, 1800)) * 1000
    let interval = Math.max(2, Math.min(Number(started.interval) || 5, 60)) * 1000
    await deps.setView({ phase: 'waiting', slot, user_code: userCode, verification_uri: uri, expires_at: expiresAt })

    const poll = async () => {
      if (gen !== generation) return
      if ((await deps.now()) >= expiresAt) {
        await deps.setView({ phase: 'error', slot, message: 'El código venció sin aprobarse. Corre /link pair otra vez.' })
        return
      }
      /** @type {any} */
      let r
      try {
        r = await client.pairPoll({ device_code: deviceCode })
      } catch (err) {
        r = { status: 'network', error: err }
      }
      if (gen !== generation) return
      if (r.status === 'ok') return finish(slot, r)
      if (r.status === 'access_denied') return deps.setView({ phase: 'error', slot, message: 'Un admin rechazó este emparejamiento.' })
      if (r.status === 'expired_token') return deps.setView({ phase: 'error', slot, message: 'El código venció. Corre /link pair otra vez.' })
      if (r.status === 'slow_down') interval += 5000
      deps.schedule(interval, () => void poll())
    }
    deps.schedule(interval, () => void poll())
    const where = uri ? ` en ${uri}` : ' en el dashboard'
    return { ok: true, text: `Emparejando "${slot}". Código: ${userCode}. Un admin lo aprueba${where} (con 2FA); esta sesión espera sola.` }
  }

  /**
   * @param {string} slot
   * @param {{ token: string, address_prefix?: string, hub_url?: string }} r
   */
  async function finish(slot, r) {
    const gen = generation
    const base = { phase: /** @type {const} */ ('done'), slot, address_prefix: r.address_prefix }
    await deps.setView({ ...base, token: r.token, saved: 'saving', note: 'Guardando el token…' })
    try {
      await deps.writeTokenFile(r.token)
      await deps.setView({ ...base, saved: 'file', note: `Emparejado. Token guardado en ${deps.tokenPath} (permisos 0600); ya no se muestra.` })
    } catch {
      const note = 'No se pudo guardar en archivo: cópialo ahora y pégalo en /plugin → sielay-link → link_token. Sirve para esta sesión mientras tanto; se oculta en 5 min.'
      await deps.setView({ ...base, token: r.token, saved: 'failed', note })
      deps.schedule(TOKEN_SHOWN_MS, () => {
        if (gen !== generation) return
        void deps.setView({ ...base, saved: 'failed', note: 'El token ya no se muestra. Si no lo copiaste, corre /link pair otra vez.' })
      })
    }
    await deps.onToken(r.token, { address_prefix: r.address_prefix, hub_url: r.hub_url })
  }

  return { start, cancel: () => void (generation += 1) }
}
