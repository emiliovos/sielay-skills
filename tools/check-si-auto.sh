#!/usr/bin/env bash
# Safety gate for the optional `si-auto` plugin. Runs in CI and before every release.
# Allow-list based like check-plugin.sh: only the known files, the four hook events,
# read-only git (`rev-parse`), no network, and writes only under $D
# (<git-common-dir>/si-auto). Anything else fails.
#
#   usage: tools/check-si-auto.sh [plugin-dir]
set -euo pipefail

fail=0
err() { echo "ERROR: $*" >&2; fail=1; }

root="${1:-plugins/si-auto}"
[ -d "$root" ] || { echo "ERROR: plugin dir not found: $root" >&2; exit 1; }
root="$(cd "$root" && pwd -P)"
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required" >&2; exit 1; }

# --- Exact file allow-list; no symlinks.
allowed=".claude-plugin .claude-plugin/plugin.json hooks hooks/hooks.json scripts
scripts/comun.sh scripts/leer-json.py scripts/stop.sh scripts/pre-compact.sh
scripts/session-end.sh scripts/session-start.sh scripts/ver-notas.sh"
while IFS= read -r -d '' p; do
  rel="${p#"$root"/}"
  [ -L "$p" ] && err "symlink not allowed: $rel"
  grep -qxF "$rel" <<<"$(tr ' ' '\n' <<<"$allowed")" || err "$rel is not allowed in si-auto"
done < <(find "$root" -mindepth 1 -print0)

# --- Manifests: identity, dependency and the exact hook wiring.
python3 - "$root" <<'PY' | while IFS= read -r line; do [ -n "$line" ] && echo "ERROR: $line" >&2 && echo x; done | grep -q x && fail=1
import json, sys
root, out = sys.argv[1], []
try:
    pj = json.load(open(f"{root}/.claude-plugin/plugin.json", encoding="utf-8"))
    hj = json.load(open(f"{root}/hooks/hooks.json", encoding="utf-8"))
except Exception as e:
    print(f"invalid manifest JSON ({e})"); sys.exit()
extra = set(pj) - {"name", "description", "author", "homepage", "license", "keywords", "repository", "version", "dependencies"}
out += [f"plugin.json: key not allowed: {k}" for k in sorted(extra)]
if pj.get("name") != "si-auto": out.append('plugin.json: name must be "si-auto"')
if pj.get("dependencies") != ["si@sielay"]: out.append('plugin.json: dependencies must be exactly ["si@sielay"]')
want = {"Stop": "stop.sh", "PreCompact": "pre-compact.sh", "SessionEnd": "session-end.sh", "SessionStart": "session-start.sh"}
if set(hj) != {"hooks"}: out.append("hooks.json: only the top-level key 'hooks' is allowed")
events = hj.get("hooks") or {}
if set(events) != set(want): out.append(f"hooks.json: events must be exactly {sorted(want)}")
for ev, script in want.items():
    expected = [{"hooks": [{"type": "command", "command": f'"${{CLAUDE_PLUGIN_ROOT}}/scripts/{script}"'}]}]
    if events.get(ev) != expected: out.append(f"hooks.json: {ev} must run only scripts/{script}")
print("\n".join(out))
PY

# --- Scripts: forbidden commands and flags anywhere (raw text, strings included).
sh="$root/scripts"
forbidden='\b(curl|wget|nc|ncat|ssh|scp|rsync|sudo|eval|exec|base64|xxd)\b|/dev/tcp|--no-verify|--force|\bgit[[:space:]]+(add|commit|push|reset|checkout|switch|stash|clean|rm|mv|restore|config|update-ref|tag|merge|rebase)\b'
if hits=$(grep -nE "$forbidden" "$sh"/*.sh); then echo "$hits" >&2; err "forbidden command or flag in a script"; fi

# Code view of the scripts: comments, heredoc bodies, arithmetic and plain string
# literals removed, so "<si-auto-nota>" in a message is not read as a redirection.
# Double-quoted strings with a $ are kept, so paths and hidden commands are still checked.
code="$(python3 - "$sh"/*.sh <<'PY'
import re, sys

def strip_strings(line):
    """Drop '...' and "..." literals; keep "..." with a $ (paths, hidden commands)."""
    out, i = [], 0
    while i < len(line):
        c = line[i]
        if c == "'":
            j = line.find("'", i + 1)
            j = len(line) if j < 0 else j
            out.append("''"); i = j + 1
        elif c == '"':
            j, depth = i + 1, 0
            while j < len(line) and not (line[j] == '"' and depth == 0):
                if line[j] == "\\": j += 1
                elif line.startswith("$(", j): depth += 1; j += 1
                elif line[j] == ")" and depth: depth -= 1
                j += 1
            text = line[i:j + 1]
            out.append(text if "$" in text else '""'); i = j + 1
        else:
            out.append(c); i += 1
    return "".join(out)

for path in sys.argv[1:]:
    name, heredoc = path.rsplit("/", 1)[1], None
    for n, line in enumerate(open(path, encoding="utf-8"), 1):
        line = line.rstrip("\n")
        if heredoc:
            if line.strip() == heredoc: heredoc = None
            continue
        m = re.search(r"<<-?\s*'?([A-Z]+)'?", line)
        if m: heredoc = m.group(1)
        line = strip_strings(re.sub(r"\$\(\(.*?\)\)", "", line))
        line = re.sub(r"(^|\s)#.*$", "", line)
        if line.strip(): print(f"{name}:{n}:{line}")
PY
)"

# Every git call must be read-only `git -C <dir> rev-parse`.
if hits=$(grep -E '\bgit\b' <<<"$code" | grep -vE 'git -C "[^"]*" rev-parse '); then
  echo "$hits" >&2; err "git may only be called as: git -C <dir> rev-parse"
fi
# Only comun.sh and ver-notas.sh may define where notes live, and only as <git-common-dir>/si-auto.
if hits=$(grep -nE '(^|[^A-Za-z_])D=' "$sh"/*.sh | grep -vE '(comun|ver-notas)\.sh:[0-9]+:[[:space:]]*(D=""|D="\$comun/si-auto")$'); then
  echo "$hits" >&2; err "D (the notes dir) may only be set to \"\$comun/si-auto\""
fi
# Every write must have one of these exact shapes, all under $D (or the .meta files in it).
write_ok='>> "\$D/bitacora\.log"|> "\$D/\$SESION\.md\.tmp" && mv "\$D/\$SESION\.md\.tmp" "\$D/\$SESION\.md"|> "\$1\.tmp" && mv "\$1\.tmp" "\$1"|: > "\$D/falta-python3"|rm -f "\$D/falta-python3"|rm -f "\$m"|mv "\$D/\$id\.md" "\$D/entregadas/\$id\.md"|mv "\$m" "\$D/entregadas/\$id\.meta"|mkdir -p "\$D/entregadas"|find "\$D/entregadas" -type f -mtime \+14 -delete|[0-9]?>/dev/null|[0-9]?>&[0-9]|<<<|< <\(|<<'
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  rest="$(sed -E "s#$write_ok##g" <<<"${hit#*:*:}")"
  if grep -qE '>|\b(mv|rm|cp|tee|touch|ln|mkdir|find|dd|truncate|install)\b' <<<"$rest"; then
    echo "$hit" >&2; err "write outside the allowed shapes (only under \$D)"
  fi
done <<<"$code"

# --- Python helper: no network, no subprocesses, no file writes.
py="$sh/leer-json.py"
if hits=$(grep -nE '^\s*(import|from)\s+(socket|urllib|http|subprocess|os|shutil|ctypes|requests)\b|\bopen\([^)]*["'"'"'][wax+]|__import__|exec\(|eval\(' "$py"); then
  echo "$hits" >&2; err "leer-json.py may only read (no network, subprocesses or writes)"
fi

# --- Private data: same patterns as check-plugin.sh.
patterns='gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9-]{20,}'
patterns+='|(AKIA|ASIA)[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,}'
patterns+='|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
patterns+='|192\.168\.[0-9]+\.[0-9]+|10\.[0-9]+\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+'
patterns+='|[A-Za-z0-9-]+\.(local|lan|ts\.net)([^A-Za-z0-9.-]|$|\.([^A-Za-z0-9]|$))'
patterns+='|/root/|/home/[A-Za-z0-9._-]+|/Users/[A-Za-z0-9._-]+|[A-Za-z]:(\\+|/)Users'
if hits=$(grep -rInE "$patterns" "$root" 2>/dev/null); then
  echo "$hits" >&2; err "possible secret, private address, internal hostname or personal path"
fi

if [ "$fail" -eq 0 ]; then echo "check-si-auto: OK ($root)"; fi
exit "$fail"
