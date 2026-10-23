#!/bin/sh
# headersHelper of the `sielay` MCP server (.mcp.json). With Node on the PATH it runs
# sielay-mcp-headers.mjs; Claude Code installed natively does not bring Node, so without it
# this POSIX sh does the same with curl: it reads ~/.claude/sielay-link/token, trades it for a
# new 24 h MCP token (POST /api/up/mcp-token) and prints {"Authorization":"Bearer <token>"}.
# Nothing is written to disk. The credential reaches curl on stdin (-H @-), never in argv.
# Fails closed with a message on stderr that never carries a token.
set -u
here=$(dirname "$0")
if command -v node >/dev/null 2>&1; then exec node "$here/sielay-mcp-headers.mjs"; fi

HUB="https://sielay.cloud"
fail() { printf 'sielay-mcp-headers: %s\n' "$1" >&2; exit "${2:-1}"; }
command -v curl >/dev/null 2>&1 || fail "hace falta node o curl"
file="${HOME:-}/.claude/sielay-link/token"
[ -r "$file" ] || fail "no está $file; conéctala otra vez con: curl -fsSL https://sielay.cloud/up | bash" 2
grep -Eqx 'slk_[A-Za-z0-9_-]{43}' "$file" || fail "$file no tiene una credencial de sielay-link válida" 2

resp=$( { printf 'Authorization: Bearer '; tr -d '\n' < "$file"; printf '\n'; } |
  curl -q -sS --max-time 10 --proto '=https' -X POST -H @- -H 'Content-Type: application/json' \
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
