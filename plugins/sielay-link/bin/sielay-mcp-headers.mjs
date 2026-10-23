#!/usr/bin/env node
// headersHelper of the `sielay` MCP server (.mcp.json, through sielay-mcp-headers.sh).
// Claude Code runs it once per MCP connection and reads one JSON object of headers
// from stdout. It reads this machine's sielay-link credential (~/.claude/sielay-link/token,
// written by `curl -fsSL https://sielay.cloud/up | bash`), trades it for a new MCP token
// (POST /api/up/mcp-token, 24 h) and prints {"Authorization":"Bearer <token>"}.
// The MCP token is never written anywhere: the next connection asks for another one.
// Fails closed: without the file, or on any answer that is not a token, it exits non-zero
// with a message on stderr that never carries a token. No dependencies.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HUB = 'https://sielay.cloud'
const LINK_TOKEN = /^slk_[A-Za-z0-9_-]{43}$/
const MCP_TOKEN = /^[0-9a-f]{64}$/
const REJOIN = 'conéctala otra vez con: curl -fsSL https://sielay.cloud/up | bash'
const REASONS = {
  401: `el hub no reconoce la credencial de esta máquina (revocada o reemplazada); ${REJOIN}`,
  503: 'sielay-link está apagado en el hub',
}
const CODES = {
  mcp_not_enabled: `esta máquina no tiene acceso al MCP; ${REJOIN}`,
  person_only: 'el MCP de sielay es solo para personas del equipo',
  rate_limited: 'demasiados tokens MCP para esta máquina en la última hora; espera un poco',
}

function fail(message, code = 1) {
  process.stderr.write(`sielay-mcp-headers: ${message}\n`)
  process.exit(code)
}

function credential() {
  const path = join(process.env.HOME || homedir(), '.claude', 'sielay-link', 'token')
  let text
  try {
    text = readFileSync(path, 'utf8').trim()
  } catch {
    fail(`no está ${path}; ${REJOIN}`, 2)
  }
  if (!LINK_TOKEN.test(text)) fail(`${path} no tiene una credencial de sielay-link válida`, 2)
  return text
}

const slk = credential()
let res
try {
  res = await fetch(`${HUB}/api/up/mcp-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${slk}`, 'Content-Type': 'application/json', 'X-Requested-With': 'sielay-mcp-helper' },
    body: '{}',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
} catch (e) {
  fail(`no hay conexión con ${HUB} (${e?.name ?? 'error'})`)
}
let body = null
try {
  body = await res.json()
} catch {
  // not JSON: handled below
}
if (res.status !== 200) fail(CODES[body?.code] ?? REASONS[res.status] ?? `el hub respondió ${res.status}`)
const token = typeof body?.token === 'string' ? body.token : ''
if (!MCP_TOKEN.test(token)) fail('el hub respondió algo que no es un token MCP')
process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}` }))
