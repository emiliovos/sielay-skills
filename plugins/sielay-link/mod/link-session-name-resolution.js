// Session name resolution and cwd hashing. Pure (no `$`): the mod gathers the
// candidate sources and this module picks one, in the order the hub contract
// fixes: env var, `/link name` saved for this cwd, project file, tmux session,
// native `/rename` title (classic UserPromptSubmit `session_title`), folder.

const MAX_LEN = 40

/**
 * Lowercases and reduces a candidate to the address segment alphabet
 * `[a-z0-9-]{1,40}`; returns '' when nothing usable is left.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeName(raw) {
  if (typeof raw !== 'string') return ''
  const ascii = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.slice(0, MAX_LEN).replace(/-+$/g, '')
}

/**
 * @param {string|undefined} cwd
 * @returns {string}
 */
function folderOf(cwd) {
  if (typeof cwd !== 'string') return ''
  const parts = cwd.split(/[\\/]+/).filter(Boolean)
  const last = parts[parts.length - 1] ?? ''
  return /^[A-Za-z]:$/.test(last) ? '' : last
}

/**
 * @typedef {{ env?: string, saved?: string, projectFile?: string, tmux?: string, nativeTitle?: string, cwd?: string }} NameSources
 * @typedef {'env'|'saved'|'project'|'tmux'|'native'|'folder'|'default'} NameSource
 */

/**
 * @param {NameSources} sources
 * @returns {{ name: string, source: NameSource }}
 */
export function resolveSessionName(sources) {
  /** @type {Array<[NameSource, unknown]>} */
  const ordered = [
    ['env', sources.env],
    ['saved', sources.saved],
    ['project', sources.projectFile],
    ['tmux', sources.tmux],
    ['native', sources.nativeTitle],
    ['folder', folderOf(sources.cwd)],
  ]
  for (const [source, raw] of ordered) {
    const name = normalizeName(raw)
    if (name !== '') return { name, source }
  }
  return { name: 'session', source: 'default' }
}

/**
 * sha256 of the cwd, first 32 hex chars. The hub only compares it, never
 * reverses it; the cwd itself never leaves the machine.
 *
 * @param {string} cwd
 * @returns {Promise<string>}
 */
export async function cwdHash(cwd) {
  const bytes = new TextEncoder().encode(String(cwd))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}
