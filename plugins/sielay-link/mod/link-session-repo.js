// The `owner/repo` a session works in, read from its git config (the GitHub
// remote `origin`), so the hub can tell it when its repo merges (C1). A
// linked worktree's `.git` is a file pointing at its gitdir; its config is the
// main checkout's. Read-only, never runs git; null when there is no GitHub
// origin. Cached per folder: a remote rarely changes in a session.

const ORIGIN = /\[remote\s+"origin"\]([^[]*)/
const URL_LINE = /^\s*url\s*=\s*(\S+)\s*$/m
const GITHUB = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/

/**
 * `owner/repo` from the text of a git config, or null.
 * @param {string} config
 * @returns {string|null}
 */
export function repoFromGitConfig(config) {
  const section = ORIGIN.exec(String(config))?.[1]
  const url = section ? URL_LINE.exec(section)?.[1] : undefined
  const m = url ? GITHUB.exec(url) : null
  return m ? `${m[1]}/${m[2]}` : null
}

/**
 * The config path of the checkout at `dir`: `.git/config`, or, for a linked
 * worktree, the common dir its gitdir names.
 * @param {{ fs: { read: (p: string) => Promise<unknown> } }} $
 * @param {string} dir
 */
async function configText($, dir) {
  try {
    return String(await $.fs.read(`${dir}/.git/config`))
  } catch {
    const pointer = /^gitdir:\s*(.+)$/m.exec(String(await $.fs.read(`${dir}/.git`)))?.[1]?.trim()
    if (!pointer) return ''
    const gitdir = pointer.startsWith('/') ? pointer : `${dir}/${pointer}`
    let common = gitdir
    try {
      const rel = String(await $.fs.read(`${gitdir}/commondir`)).trim()
      common = rel.startsWith('/') ? rel : `${gitdir}/${rel}`
    } catch {
      // a gitdir without commondir holds its own config
    }
    return String(await $.fs.read(`${common}/config`))
  }
}

/** @type {Map<string, string|null>} */
const cache = new Map()

/**
 * @param {{ fs: { read: (p: string) => Promise<unknown> } }} $
 * @param {string} dir the session's project folder
 * @returns {Promise<string|null>}
 */
export async function sessionRepo($, dir) {
  const key = dir.replace(/[\\/]+$/, '')
  if (cache.has(key)) return cache.get(key) ?? null
  let repo = null
  try {
    repo = repoFromGitConfig(await configText($, key))
  } catch {
    repo = null
  }
  if (cache.size > 50) cache.clear()
  cache.set(key, repo)
  return repo
}
