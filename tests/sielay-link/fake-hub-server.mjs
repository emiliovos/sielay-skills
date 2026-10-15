// A fake sielay-link hub over node:http for client tests. Implements just the
// contract slice the client touches (contracts §3): poll (gate at lease),
// decide (strip only), ack, plus test-side admin actions (hold, release).
import http from 'node:http'

/**
 * @param {{ token: string }} opts
 */
export async function startFakeHub({ token }) {
  const messages = new Map() // id -> { delivery, gate, status }
  const log = [] // every request: { path, body, auth }
  const receiver = { mode: 'default', mode_fresh: 0 }

  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      const path = new URL(req.url, 'http://x').pathname
      log.push({ method: req.method, path, body, auth: req.headers.authorization })
      const send = (status, json) => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(json))
      }
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { code: 'bad_token' })

      if (path === '/api/link/poll') {
        if (body.session) Object.assign(receiver, { mode: body.session.mode, mode_fresh: body.session.mode_fresh })
        for (const a of body.ack ?? []) {
          const m = messages.get(a.id)
          if (m) m.status = 'acked'
        }
        const out = []
        for (const m of messages.values()) {
          if (m.status !== 'queued') continue
          if (m.gate === 'accepted') {
            // Phase 2 decideLease: a person accepted it; redelivered with run=1 until acked.
            m.status = 'delivered'
            out.push({ ...m.delivery, run: 1, gate: 'accepted' })
            continue
          }
          if (m.gate !== 'auto') continue
          const run = receiver.mode === 'bypassPermissions' && receiver.mode_fresh === 1 ? 1 : 0
          if (!run) m.gate = 'strip'
          m.status = 'delivered'
          out.push({ ...m.delivery, run, gate: m.gate })
        }
        const strip = [...messages.values()]
          .filter(m => m.gate === 'strip' && m.status !== 'acked')
          .map(m => ({ ...m.delivery, run: 0, gate: 'strip' }))
        return send(200, { session: { id: 'sess-1', address: 'eva/box/api', name_assigned: body.session?.name }, messages: out, strip, poll_after_ms: 0 })
      }
      if (path === '/api/link/decide') {
        const m = messages.get(body.id)
        if (!m || m.gate !== 'strip') return send(409, { code: 'not_in_strip' })
        m.gate = body.decision
        return send(200, { gate: m.gate })
      }
      if (path === '/api/link/ack') {
        for (const a of body.ack ?? []) {
          const m = messages.get(a.id)
          if (m) m.status = 'acked'
        }
        return send(200, {})
      }
      return send(404, { code: 'not_found' })
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())

  return {
    port,
    log,
    messages,
    /** Queues a message the sender's gate held (never leased). */
    hold(delivery) {
      messages.set(delivery.id, { delivery, gate: 'held', status: 'queued' })
    },
    /** Dashboard release: held → strip, re-queued. Never injects. */
    release(id) {
      const m = messages.get(id)
      m.gate = 'strip'
      m.status = 'queued'
    },
    close: () => new Promise(r => server.close(r)),
  }
}

/**
 * An `http` object like `$.http` that sends the allow-listed origin to the
 * fake hub. Production code is untouched: the URL is rewritten here only.
 *
 * @param {number} port
 */
export function httpToFakeHub(port) {
  return {
    async fetch(url, init = {}) {
      const local = url.replace(/^https:\/\/sielay\.(cloud|vostec\.mx)/, `http://127.0.0.1:${port}`)
      const res = await fetch(local, { ...init, redirect: 'manual' })
      return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), text: await res.text() }
    },
  }
}
