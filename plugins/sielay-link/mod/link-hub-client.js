// The hub client: the only module that talks to the network. It takes the
// engine `$` (only `$.http.fetch` is used) so tests pass a fake `$`.
//
// Security (public plugin running inside bypass sessions):
// - the hub origin is allow-listed; any other `hub_url` is refused at load;
// - redirects: `$.http.fetch` follows them itself (up to 5) and, across
//   origins, drops every header but accept/content-type, so the Bearer token
//   never reaches another origin. A 3xx that does reach this code (a build
//   that stops following) is treated as an error, never followed by hand;
// - 503 pauses, 401 stops, 429 backs off: the caller reads `HubError.kind`.

export const ALLOWED_HUB_ORIGINS = Object.freeze(['https://sielay.cloud', 'https://sielay.vostec.mx'])
export const DEFAULT_HUB_URL = 'https://sielay.cloud'

/** @typedef {'hub_url'|'no_token'|'paused'|'unauthorized'|'rate_limited'|'redirect'|'http'|'network'|'invalid_json'|'invalid'} HubErrorKind */

export class HubError extends Error {
  /**
   * @param {HubErrorKind} kind
   * @param {string} message
   * @param {{ status?: number, code?: string, field?: string, scope?: string, retryAfterMs?: number }} [extra]
   */
  constructor(kind, message, extra = {}) {
    super(message)
    this.name = 'HubError'
    this.kind = kind
    this.status = extra.status
    this.code = extra.code
    this.field = extra.field
    /** What a 409 link_paused names as off: person, line, device or session. */
    this.scope = extra.scope
    this.retryAfterMs = extra.retryAfterMs
  }
}

/**
 * Returns the allow-listed origin for `hub_url`, or throws `HubError('hub_url')`.
 * Only a bare origin (optional trailing slash) is accepted: no path, query,
 * userinfo or port, so nothing can smuggle a different target.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeHubUrl(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_HUB_URL
  if (typeof raw !== 'string') throw new HubError('hub_url', 'hub_url must be a string')
  /** @type {URL} */
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    throw new HubError('hub_url', 'hub_url is not a URL')
  }
  const bare = url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === ''
  if (!bare || !ALLOWED_HUB_ORIGINS.includes(url.origin) || url.port !== '') {
    throw new HubError('hub_url', `hub_url must be one of ${ALLOWED_HUB_ORIGINS.join(', ')}`)
  }
  return url.origin
}

/**
 * @typedef {{ status: number, ok: boolean, headers: Record<string, string>, text: string }} HttpResponseLike
 * @typedef {{ http: { fetch: (url: string, init?: { method?: string, headers?: Record<string, string>, body?: string }) => Promise<HttpResponseLike> } }} HttpEngine
 */

/**
 * @param {unknown} text
 * @returns {any}
 */
function parseJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return {}
  return JSON.parse(text)
}

/**
 * @param {Record<string, string>|undefined} headers
 * @returns {number|undefined}
 */
function retryAfterMs(headers) {
  const v = Number(headers?.['retry-after'])
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 600) * 1000 : undefined
}

/**
 * @param {HttpEngine} $ the engine (or a fake with `http.fetch`)
 * @param {{ hubUrl: unknown, token: string|undefined }} opts
 */
export function createHubClient($, { hubUrl, token }) {
  const origin = normalizeHubUrl(hubUrl)

  /**
   * @param {'GET'|'POST'} method
   * @param {string} path
   * @param {unknown} [body]
   * @param {{ auth?: boolean, rawErrors?: boolean }} [opts]
   * @returns {Promise<{ status: number, data: any }>}
   */
  async function call(method, path, body, { auth = true, rawErrors = false } = {}) {
    /** @type {Record<string, string>} */
    const headers = { accept: 'application/json', 'x-requested-with': 'sielay-link' }
    if (auth) {
      if (typeof token !== 'string' || token === '') throw new HubError('no_token', 'not paired: no link token')
      headers.authorization = `Bearer ${token}`
    }
    if (body !== undefined) headers['content-type'] = 'application/json'

    /** @type {HttpResponseLike} */
    let res
    try {
      res = await $.http.fetch(`${origin}/api/link${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (err) {
      throw new HubError('network', `hub unreachable: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (res.status >= 300 && res.status < 400) {
      throw new HubError('redirect', `hub answered a redirect (${res.status}); not followed by the client`, { status: res.status })
    }
    /** @type {any} */
    let data
    try {
      data = parseJson(res.text)
    } catch {
      if (res.status >= 200 && res.status < 300) throw new HubError('invalid_json', 'hub answered non-JSON', { status: res.status })
      data = {}
    }
    if (res.status >= 200 && res.status < 300) return { status: res.status, data }
    if (rawErrors && res.status === 400) return { status: res.status, data }

    const code = typeof data?.code === 'string' ? data.code : typeof data?.error === 'string' ? data.error : undefined
    if (res.status === 503) throw new HubError('paused', 'hub paused (link disabled)', { status: 503, code })
    if (res.status === 401) throw new HubError('unauthorized', 'link token rejected', { status: 401, code })
    if (res.status === 429) {
      throw new HubError('rate_limited', 'hub rate limit', { status: 429, code, retryAfterMs: retryAfterMs(res.headers) })
    }
    const field = typeof data?.field === 'string' ? data.field.slice(0, 64) : undefined
    const scope = typeof data?.scope === 'string' ? data.scope.slice(0, 16) : undefined
    throw new HubError('http', `hub answered ${res.status}${code ? ` ${code}` : ''}`, { status: res.status, code, field, scope })
  }

  return {
    origin,
    /** @param {object} body */
    poll: async body => (await call('POST', '/poll', body)).data,
    /** @param {object} body */
    send: async body => (await call('POST', '/send', body)).data,
    /** @param {object} body */
    ack: async body => (await call('POST', '/ack', body)).data,
    /** @param {{ session: object, id: string, decision: string }} body */
    decide: async body => {
      if (body.decision !== 'accepted' && body.decision !== 'rejected') {
        throw new HubError('invalid', 'decision must be accepted or rejected')
      }
      return (await call('POST', '/decide', body)).data
    },
    /** @param {{ session: object }} body the terminal closing: the hub retires this session's row */
    endSession: async body => (await call('POST', '/sessions/self/end', body)).data,
    peers: async () => (await call('GET', '/peers')).data,
    /** @param {{ slot: string, hostname?: string, client_version?: string }} body */
    pairStart: async body => (await call('POST', '/pair/start', body, { auth: false })).data,
    /**
     * @param {{ device_code: string }} body
     * @returns {Promise<{ status: string, token?: string, address_prefix?: string, hub_url?: string }>}
     */
    pairPoll: async body => {
      const { status, data } = await call('POST', '/pair/poll', body, { auth: false, rawErrors: true })
      if (status === 400) return { status: typeof data?.error === 'string' ? data.error : 'invalid' }
      if (typeof data?.token !== 'string' || data.token === '') throw new HubError('invalid', 'pairing answer has no token')
      return { status: 'ok', token: data.token, address_prefix: data.address_prefix, hub_url: normalizeHubUrl(data.hub_url) }
    },
  }
}

/** @typedef {ReturnType<typeof createHubClient>} HubClient */
