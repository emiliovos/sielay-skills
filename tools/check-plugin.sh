#!/usr/bin/env bash
# Safety gate for the public `si` plugin. Runs in CI and before every sync.
# Fails on anything that would execute code or leak private data at install
# time; warns on skills that ask Claude to run shell commands.
set -euo pipefail

root="${1:-plugins/si}"
fail=0
err() { echo "ERROR: $*" >&2; fail=1; }
warn() { echo "WARN:  $*" >&2; }

# Components that run code outside the skill text (hooks, MCP servers,
# executables) are not allowed in the public plugin.
for p in hooks .mcp.json bin monitors; do
  [ -e "$root/$p" ] && err "$root/$p is not allowed in the public plugin"
done

# A package.json or lockfile at the plugin root makes Claude Code run npm.
for p in package.json package-lock.json npm-shrinkwrap.json yarn.lock pnpm-lock.yaml bun.lockb; do
  [ -e "$root/$p" ] && err "$root/$p would trigger a dependency install"
done

# Every skill needs a SKILL.md; nothing else may live next to skills/.
for d in "$root"/skills/*/; do
  [ -f "$d/SKILL.md" ] || err "${d%/} has no SKILL.md"
done

# Private data: tokens, private keys, LAN addresses, home paths.
patterns='(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|192\.168\.[0-9]+\.[0-9]+|10\.[0-9]+\.[0-9]+\.[0-9]+|/home/[a-z]+|/Users/[A-Za-z]+)'
if hits=$(grep -rInE "$patterns" "$root" 2>/dev/null); then
  echo "$hits" >&2
  err "possible secret, LAN address or personal path"
fi

# Visible warnings for reviewers: skills that run shell or ship scripts.
for f in $(grep -rlE '^allowed-tools:.*Bash' "$root"/skills/*/SKILL.md 2>/dev/null || true); do
  warn "$f allows the Bash tool — review what it runs"
done
for d in "$root"/skills/*/scripts; do
  [ -d "$d" ] && warn "$d ships scripts — review them"
done

[ "$fail" -eq 0 ] && echo "check-plugin: OK ($root)"
exit "$fail"
