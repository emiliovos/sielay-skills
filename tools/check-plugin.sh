#!/usr/bin/env bash
# Safety gate for the public `si` plugin. Runs in CI and before every release.
# Allow-list based: anything not explicitly permitted fails. Blocks components
# that execute code at install or invocation time and private data leaks;
# warns on skills that ask Claude to run shell commands.
#
#   usage: tools/check-plugin.sh [plugin-dir] [repo-root]
#   plugin-dir defaults to plugins/si; repo-root defaults to the git toplevel
#   of plugin-dir and must contain .claude-plugin/marketplace.json.
set -euo pipefail

fail=0
err() { echo "ERROR: $*" >&2; fail=1; }
warn() { echo "WARN:  $*" >&2; }

root="${1:-plugins/si}"
[ -d "$root" ] || { echo "ERROR: plugin dir not found: $root" >&2; exit 1; }
root="$(cd "$root" && pwd -P)"
if [ -n "${2:-}" ]; then
  repo="$2"
else
  repo="$(git -C "$root" rev-parse --show-toplevel 2>/dev/null)" ||
    { echo "ERROR: cannot find repo root; pass it as 2nd argument" >&2; exit 1; }
fi
[ -d "$repo" ] || { echo "ERROR: repo root not found: $repo" >&2; exit 1; }
repo="$(cd "$repo" && pwd -P)"
[ "$root" = "$repo/plugins/si" ] || err "plugin dir must be <repo>/plugins/si (got $root)"

# --- Symlinks: none anywhere in the repo (they can point outside the plugin).
while IFS= read -r -d '' l; do
  err "symlink not allowed: ${l#"$repo"/}"
done < <(find "$repo" -path "$repo/.git" -prune -o -type l -print0)

# --- Allow-list of paths inside the plugin:
#   .claude-plugin/plugin.json and skills/<slug>/** with slug ^[a-z0-9][a-z0-9-]*$.
# Everything else (commands/, agents/, hooks/, bin/, monitors/, settings.json,
# .mcp.json, .lsp.json, *.mcpb, package.json, lockfiles, ...) is rejected.
slug_re='^[a-z0-9][a-z0-9-]*$'
while IFS= read -r -d '' p; do
  rel="${p#"$root"/}"
  case "$rel" in
    .claude-plugin) [ -d "$p" ] || err "$rel must be a directory" ;;
    .claude-plugin/plugin.json) [ -f "$p" ] || err "$rel must be a regular file" ;;
    skills) [ -d "$p" ] || err "$rel must be a directory" ;;
    skills/*)
      slug="${rel#skills/}"; slug="${slug%%/*}"
      if [ "$rel" = "skills/$slug" ]; then
        if [ ! -d "$p" ] || [ -L "$p" ]; then
          err "$rel: only skill directories may live in skills/"
        elif ! [[ "$slug" =~ $slug_re ]]; then
          err "$rel: skill slug must match $slug_re"
        fi
      fi ;;
    *) err "$rel is not allowed in the public plugin (only .claude-plugin/plugin.json and skills/<slug>/**)" ;;
  esac
done < <(find "$root" -mindepth 1 -print0)

# --- Every skill needs a SKILL.md.
[ -d "$root/skills" ] || err "plugin has no skills/ directory"
for d in "$root"/skills/*/; do
  [ -d "$d" ] || continue
  [ -f "$d/SKILL.md" ] || err "${d%/} has no SKILL.md"
done

# --- Manifests: fixed identity and an allow-list of keys. jq, else python3.
plugin_jq='if type != "object" then "plugin.json is not a JSON object" else
  ((keys - ["name","description","author","homepage","license","keywords","repository","version"])[]
    | "plugin.json: key not allowed: \(.)"),
  (if .name != "si" then "plugin.json: name must be \"si\"" else empty end) end'
market_jq='if type != "object" then "marketplace.json is not a JSON object" else
  ((keys - ["name","owner","description","plugins","metadata"])[]
    | "marketplace.json: top-level key not allowed: \(.)"),
  (if .name != "sielay" then "marketplace.json: name must be \"sielay\"" else empty end),
  (if (.plugins | type) != "array" or (.plugins | length) < 1 or (.plugins | length) > 2
   then "marketplace.json: plugins must list si and, optionally, si-auto"
   else .plugins | to_entries[] | .key as $i | ([["si","./plugins/si"],["si-auto","./plugins/si-auto"]][$i]) as $want
     | .value | if type != "object" then "marketplace.json: plugin entry is not an object" else
     ((keys - ["name","source","description"])[] | "marketplace.json: plugin key not allowed: \(.)"),
     (if .name != $want[0] then "marketplace.json: plugin \($i + 1) name must be \"\($want[0])\"" else empty end),
     (if .source != $want[1] then "marketplace.json: plugin \($i + 1) source must be \"\($want[1])\"" else empty end)
   end end) end'
read -r -d '' check_py <<'PY' || true
import json, sys
kind, path = sys.argv[1], sys.argv[2]
try:
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
except Exception as e:
    print(f"{kind}: invalid JSON ({e})"); sys.exit(0)
out = []
def keys(obj, allowed, label):
    out.extend(f"{label}: {k}" for k in sorted(set(obj) - set(allowed)))
if kind == "plugin.json":
    if not isinstance(d, dict):
        out.append("plugin.json is not a JSON object")
    else:
        keys(d, ["name","description","author","homepage","license","keywords","repository","version"],
             "plugin.json: key not allowed")
        if d.get("name") != "si": out.append('plugin.json: name must be "si"')
else:
    if not isinstance(d, dict):
        out.append("marketplace.json is not a JSON object")
    else:
        keys(d, ["name","owner","description","plugins","metadata"], "marketplace.json: top-level key not allowed")
        if d.get("name") != "sielay": out.append('marketplace.json: name must be "sielay"')
        ps = d.get("plugins")
        # Order is fixed: si first, then the optional si-auto.
        want = [("si", "./plugins/si"), ("si-auto", "./plugins/si-auto")]
        if not isinstance(ps, list) or not 1 <= len(ps) <= 2:
            out.append("marketplace.json: plugins must list si and, optionally, si-auto")
        else:
            for i, (p, (name, source)) in enumerate(zip(ps, want), 1):
                if not isinstance(p, dict):
                    out.append("marketplace.json: plugin entry is not an object"); continue
                keys(p, ["name","source","description"], "marketplace.json: plugin key not allowed")
                if p.get("name") != name: out.append(f'marketplace.json: plugin {i} name must be "{name}"')
                if p.get("source") != source: out.append(f'marketplace.json: plugin {i} source must be "{source}"')
print("\n".join(out))
PY
check_json() { # kind file jq-program
  local out
  [ -f "$2" ] || { err "$1 missing: $2"; return; }
  if command -v jq >/dev/null 2>&1; then
    out="$(jq -r "$3" "$2" 2>&1)" || { err "$1: invalid JSON ($out)"; return; }
  elif command -v python3 >/dev/null 2>&1; then
    out="$(python3 -c "$check_py" "$1" "$2")" || { err "$1: python3 check failed"; return; }
  else
    err "need jq or python3 to validate $1"; return
  fi
  while IFS= read -r line; do
    if [ -n "$line" ]; then err "$line"; fi
  done <<<"$out"
}
check_json plugin.json "$root/.claude-plugin/plugin.json" "$plugin_jq"
check_json marketplace.json "$repo/.claude-plugin/marketplace.json" "$market_jq"

# --- SKILL.md: no code execution when the skill is rendered or invoked.
# Dynamic context injection runs shell before Claude sees the skill:
#   inline  !`cmd`   and fenced blocks opening with ```!  (we also reject ~~~!).
# Frontmatter `hooks:` registers hooks for the rest of the session.
frontmatter() { awk 'NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} NR>1' "$1"; }
for f in "$root"/skills/*/SKILL.md; do
  [ -f "$f" ] || continue
  rel="${f#"$root"/}"
  if hits=$(grep -nE '!`|^[[:space:]]*(```+|~~~+)[[:space:]]*!' "$f"); then
    echo "$hits" >&2
    err "$rel uses dynamic command execution (!\`cmd\` or \`\`\`! block)"
  fi
  if frontmatter "$f" | grep -qE '^[[:space:]]*hooks[[:space:]]*:'; then
    err "$rel declares hooks in its frontmatter"
  fi
  # Visible warning for reviewers: skills that pre-approve the Bash tool.
  if frontmatter "$f" | grep -q 'Bash'; then
    warn "$rel allows the Bash tool — review what it runs"
  fi
done

# --- Private data: tokens, private keys, private network addresses, internal
# hostnames, home paths. Scans the plugin and the marketplace manifest.
patterns='gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9-]{20,}'
patterns+='|(AKIA|ASIA)[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,}'
patterns+='|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
patterns+='|192\.168\.[0-9]+\.[0-9]+|10\.[0-9]+\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+'
patterns+='|[A-Za-z0-9-]+\.(local|lan|ts\.net)([^A-Za-z0-9.-]|$|\.([^A-Za-z0-9]|$))'
patterns+='|/root/|/home/[A-Za-z0-9._-]+|/Users/[A-Za-z0-9._-]+|[A-Za-z]:(\\+|/)Users'
if hits=$(grep -rInE "$patterns" "$root" "$repo/.claude-plugin/marketplace.json" 2>/dev/null); then
  echo "$hits" >&2
  err "possible secret, private address, internal hostname or personal path"
fi

# --- Visible warning for reviewers: skills that ship scripts.
for d in "$root"/skills/*/scripts; do
  if [ -d "$d" ]; then warn "${d#"$root"/} ships scripts — review them"; fi
done

if [ "$fail" -eq 0 ]; then echo "check-plugin: OK ($root)"; fi
exit "$fail"
