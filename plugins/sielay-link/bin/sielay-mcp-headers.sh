#!/bin/sh
# headersHelper of the `sielay` MCP server (.mcp.json). With Node 18+ (global fetch) on the PATH it runs
# sielay-mcp-headers.mjs; Claude Code installed natively does not bring Node, so without it
# this POSIX sh does the same with curl: it reads ~/.claude/sielay-link/token, trades it for a
# new 24 h MCP token (POST /api/up/mcp-token) and prints {"Authorization":"Bearer <token>"}.
# Nothing is written to disk. The credential reaches curl on stdin (-H @-, from the printf
# builtin), never in argv.
# Fails closed with a message on stderr that never carries a token.
set -u
here=$(dirname "$0")
if command -v node >/dev/null 2>&1 && node -e 'process.exit(typeof fetch === "function" ? 0 : 1)' 2>/dev/null; then
  exec node "$here/sielay-mcp-headers.mjs"
fi

HUB="https://sielay.cloud"
fail() { printf 'sielay-mcp-headers: %s\n' "$1" >&2; exit "${2:-1}"; }
command -v curl >/dev/null 2>&1 || fail "hace falta node o curl"
file="${HOME:-}/.claude/sielay-link/token"
[ -r "$file" ] || fail "no está $file; conéctala otra vez con: curl -fsSL https://sielay.cloud/up | bash" 2
# One read, and that same value is checked and sent: exactly slk_ + 43 characters, one line
# (a trailing newline is dropped by $(...), anything else fails closed).
slk=$(cat -- "$file") || fail "no se puede leer $file" 2
case "$slk" in
  slk_*) ;;
  *) fail "$file no tiene una credencial de sielay-link válida" 2 ;;
esac
case "${slk#slk_}" in
  *[!A-Za-z0-9_-]*) fail "$file no tiene una credencial de sielay-link válida" 2 ;;
esac
[ "${#slk}" -eq 47 ] || fail "$file no tiene una credencial de sielay-link válida" 2

# 8 s: Claude Code gives the helper 10 s.
resp=$(printf 'Authorization: Bearer %s\n' "$slk" |
  curl -q -sS --max-time 8 --proto '=https' -X POST -H @- -H 'Content-Type: application/json' \
    -H 'X-Requested-With: sielay-mcp-helper' --data '{}' -w '\n%{http_code}' "$HUB/api/up/mcp-token" 2>/dev/null) ||
  fail "no hay conexión con $HUB"
status=$(printf '%s\n' "$resp" | tail -n 1)
body=$(printf '%s\n' "$resp" | sed '$d')
if [ "$status" != 200 ]; then
  case "$body" in
    *'"mcp_not_enabled"'*) fail "esta máquina no tiene acceso al MCP; conéctala otra vez con: curl -fsSL https://sielay.cloud/up | bash" ;;
    *'"rate_limited"'*) fail "demasiados tokens MCP para esta máquina en la última hora; espera un poco" ;;
    *) fail "el hub respondió $status" ;;
  esac
fi
token=$(printf '%s' "$body" | sed -n 's/.*"token":"\([0-9a-f]\{64\}\)".*/\1/p' | head -n 1)
[ -n "$token" ] || fail "el hub respondió algo que no es un token MCP"
printf '{"Authorization":"Bearer %s"}' "$token"
