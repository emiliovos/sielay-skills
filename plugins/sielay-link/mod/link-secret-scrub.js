// Copy of the hub's secret scrubber (sielay `server/lib/link-secret-scrubber.js`),
// so a build report never carries a credential off this machine: the hub
// scrubs again on arrival. Keep the two in step. Pure.
//
// What goes (each becomes SECRET_PLACEHOLDER): the value of key/value pairs whose
// key ends in password, passwd, passphrase, secret, token, apikey or `_key`;
// `Bearer <token>`, JWTs, the password of `scheme://user:pass@`, PEM blocks, and
// link, Anthropic/OpenAI, GitHub, Slack and AWS key shapes. Over-redaction is
// accepted; leaks are not. Idempotent and linear time on any input.
export const SECRET_PLACEHOLDER = '[secreto-removido]'

const KEY_CHARS = 'A-Za-z0-9_.-'
const KEY_VALUE = new RegExp(
  `(?<![${KEY_CHARS}])(["']?)([${KEY_CHARS}]{0,64}?(?:password|passwd|passphrase|secret|token|apikey|[_.-]key))\\1` +
  '(\\s{0,8}[:=]\\s{0,8})' +
  `(?:"([^"\\n]{1,512})"|'([^'\\n]{1,512})'|(?!bearer\\s)([^\\s&,;"'<>]{1,1024}))`,
  'gi')
const BEARER = /\b(Bearer\s{1,8})[A-Za-z0-9._~+/-]{16,2048}=*/gi
const URL_PASSWORD = /([a-z][a-z0-9+.-]{0,20}:\/\/[^/\s:@]{1,256}:)([^@\s/]{1,256})@/gi
const PEM_MARKER = /-----(BEGIN|END) ([A-Z0-9 ]{1,40})-----/g
const TOKEN_PATTERNS = [
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,2048}/g,
  /(?<![A-Za-z0-9_-])slk_[A-Za-z0-9_-]{16,}/g,
  /(?<![A-Za-z0-9_-])sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}/g,
  /(?<![A-Za-z0-9-])xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
]

/**
 * Replace PEM blocks (BEGIN … matching END); a private key with no END left is cut to the end.
 * @param {string} text @returns {{ text: string, removed: number }}
 */
function scrubPem(text) {
  const markers = [...text.matchAll(PEM_MARKER)].map(m => ({ kind: m[1] ?? '', label: m[2] ?? '', index: m.index ?? 0, length: m[0].length }))
  if (!markers.length) return { text, removed: 0 }
  // nextEnd[i]: index of the first END marker at or after marker i (one backward pass).
  const nextEnd = new Array(markers.length + 1).fill(-1)
  for (let i = markers.length - 1; i >= 0; i--) nextEnd[i] = markers[i]?.kind === 'END' ? i : nextEnd[i + 1]
  let out = ''
  let cursor = 0
  let removed = 0
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i]
    if (!m || m.kind !== 'BEGIN' || m.index < cursor) continue
    const end = nextEnd[i + 1] === -1 ? null : markers[nextEnd[i + 1]]
    if (end && end.label === m.label) {
      out += text.slice(cursor, m.index) + SECRET_PLACEHOLDER
      cursor = end.index + end.length
      removed++
    } else if (!end && m.label.includes('PRIVATE KEY')) {
      out += text.slice(cursor, m.index) + SECRET_PLACEHOLDER
      cursor = text.length
      removed++
      break
    }
  }
  return { text: out + text.slice(cursor), removed }
}

/**
 * `{ text, removed }`: text with every secret replaced, and how many were replaced.
 * @param {unknown} input @returns {{ text: string, removed: number }}
 */
export function scrubSecrets(input) {
  const pem = scrubPem(typeof input === 'string' ? input : '')
  let { text, removed } = pem
  text = text.replace(BEARER, (/** @type {string} */ _m, /** @type {string} */ prefix) => { removed++; return `${prefix}${SECRET_PLACEHOLDER}` })
  text = text.replace(KEY_VALUE, (/** @type {string} */ match, /** @type {string} */ q, /** @type {string} */ key, /** @type {string} */ sep, /** @type {string|undefined} */ dq, /** @type {string|undefined} */ sq, /** @type {string|undefined} */ bare) => {
    const value = dq ?? sq ?? bare
    if (value === SECRET_PLACEHOLDER) return match
    removed++
    const quote = dq != null ? '"' : sq != null ? "'" : ''
    return `${q}${key}${q}${sep}${quote}${SECRET_PLACEHOLDER}${quote}`
  })
  text = text.replace(URL_PASSWORD, (/** @type {string} */ match, /** @type {string} */ head, /** @type {string} */ pass) => {
    if (pass === SECRET_PLACEHOLDER) return match
    removed++
    return `${head}${SECRET_PLACEHOLDER}@`
  })
  for (const pattern of TOKEN_PATTERNS) {
    text = text.replace(pattern, () => { removed++; return SECRET_PLACEHOLDER })
  }
  return { text, removed }
}
