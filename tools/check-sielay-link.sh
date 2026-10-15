#!/usr/bin/env bash
# Safety gate for the `sielay-link` plugin. Runs in CI and before every release.
# The plugin runs inside sessions that may be in bypassPermissions and carries a
# hub token, so the gate is an allow-list: known files only, the exact manifest
# and hook wiring, the hub origin allow-list, network calls only in the hub
# client, host processes only in the delivery adapter, and no secrets.
#
#   usage: tools/check-sielay-link.sh [plugin-dir]
set -euo pipefail

fail=0
err() { echo "ERROR: $*" >&2; fail=1; }

root="${1:-plugins/sielay-link}"
[ -d "$root" ] || { echo "ERROR: plugin dir not found: $root" >&2; exit 1; }
root="$(cd "$root" && pwd -P)"
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required" >&2; exit 1; }

ALLOWED_ORIGINS='https://sielay.cloud https://sielay.vostec.mx'

# --- Exact file allow-list; no symlinks. `.claude-plugin/types/` and the top-level
# `tsconfig.json` are what the engine lays beside a mod it loads from a folder
# (both git-ignored), so they are skipped.
allowed=".gitignore .claude-plugin .claude-plugin/plugin.json hooks hooks/hooks.json bin
bin/sielay-link-socket-write.mjs types types/index.d.ts README.md tests tests/sielay-link-mod.test.ts
mod mod/sielay-link-mod.js mod/link-band.jsx mod/link-pane.jsx mod/link-commands.js mod/link-delivery-adapter.js
mod/link-hub-client.js mod/link-inbound-framing.js mod/link-inbound-handler.js mod/link-mode-freshness.js
mod/link-pairing.js mod/link-poll-loop.js mod/link-run-gate.js mod/link-runtime.js mod/link-session-name-resolution.js
mod/link-session-payload.js mod/link-state-refs.js mod/link-tools.js"
while IFS= read -r -d '' p; do
  rel="${p#"$root"/}"
  case "$rel" in .claude-plugin/types|.claude-plugin/types/*|tsconfig.json) continue ;; esac
  [ -L "$p" ] && err "symlink not allowed: $rel"
  grep -qxF "$rel" <<<"$(tr ' ' '\n' <<<"$allowed")" || err "$rel is not allowed in sielay-link"
done < <(find "$root" -mindepth 1 -print0)

# --- Manifests: identity, userConfig shape, hub allow-list, exact hook wiring.
if out=$(python3 - "$root" "$ALLOWED_ORIGINS" <<'PY'
import json, re, sys
root, origins = sys.argv[1], sys.argv[2].split()
out = []
try:
    pj = json.load(open(f"{root}/.claude-plugin/plugin.json", encoding="utf-8"))
    hj = json.load(open(f"{root}/hooks/hooks.json", encoding="utf-8"))
except Exception as e:
    print(f"invalid manifest JSON ({e})"); sys.exit()
extra = set(pj) - {"name", "version", "description", "author", "homepage", "license", "keywords", "repository", "userConfig"}
out += [f"plugin.json: key not allowed: {k}" for k in sorted(extra)]
if pj.get("name") != "sielay-link": out.append('plugin.json: name must be "sielay-link"')
if not re.fullmatch(r"\d+\.\d+\.\d+", str(pj.get("version", ""))): out.append("plugin.json: version must be x.y.z")
if pj.get("license") != "MIT": out.append("plugin.json: license must be MIT")
uc = pj.get("userConfig") or {}
if set(uc) != {"link_token", "hub_url", "machine_name"}:
    out.append("plugin.json: userConfig must be exactly link_token, hub_url, machine_name")
tok = uc.get("link_token") or {}
if tok.get("sensitive") is not True: out.append("plugin.json: link_token must be sensitive")
if tok.get("required") not in (None, False): out.append("plugin.json: link_token must not be required")
if "default" in tok: out.append("plugin.json: link_token must have no default")
hub = uc.get("hub_url") or {}
if hub.get("default") not in origins: out.append("plugin.json: hub_url default must be an allow-listed origin")
if not set(hub.get("options") or []) <= set(origins): out.append("plugin.json: hub_url options must be allow-listed origins")
if (uc.get("machine_name") or {}).get("sensitive"): out.append("plugin.json: machine_name is informative, not sensitive")
if hj != {"modules": ["../mod/sielay-link-mod.js"]}:
    out.append('hooks.json: must be exactly {"modules": ["../mod/sielay-link-mod.js"]}')
print("\n".join(out))
PY
); then :; else err "manifest check could not run"; fi
if [ -n "$out" ]; then echo "$out" | sed 's/^/ERROR: /' >&2; fail=1; fi

# --- Runtime code rules (mod/ and bin/; the engine test file is exempt). They
# run on a copy with comments stripped, so prose and JSDoc types never match.
src="$(mktemp -d)"; trap 'rm -rf "$src"' EXIT
python3 - "$root" "$src" <<'PY'
import pathlib, re, sys
root, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
for sub in ("mod", "bin"):
    for f in sorted((root / sub).rglob("*")):
        if not f.is_file():
            continue
        text = f.read_text(encoding="utf-8")
        text = re.sub(r"/\*[\s\S]*?\*/", lambda m: "\n" * m.group(0).count("\n"), text)
        text = re.sub(r"(^|\s)//.*$", r"\1", text, flags=re.M)
        out = dst / f.relative_to(root)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
PY
code=("$src/mod" "$src/bin")
only_in() { # pattern allowed-file description
  local hits
  hits=$(grep -rnE "$1" "${code[@]}" | grep -v "^$src/$2:" || true)
  [ -z "$hits" ] || { echo "$hits" >&2; err "$3 outside $2"; }
}
forbid() { # pattern description
  local hits
  hits=$(grep -rnE "$1" "${code[@]}" || true)
  [ -z "$hits" ] || { echo "$hits" >&2; err "$2"; }
}
forbid '\basUser\b' 'asUser is forbidden: the plugin never types as the person'
forbid 'dangerouslySetInnerHTML' 'dangerouslySetInnerHTML is forbidden'
forbid '\beval\(|new Function\(|\bimport\(' 'eval, new Function and dynamic import are forbidden'
forbid 'child_process|\bspawn\(|process\.spawn|\$\.process\.[a-z]+[^.(a-z]' 'spawning processes other than $.process.run is forbidden'
forbid 'config\.set' '$.config.set is not used: a sensitive field throws and a plain one stores in clear'
only_in 'fetch\(' 'mod/link-hub-client.js' 'network call (fetch)'
only_in 'process\.run' 'mod/link-delivery-adapter.js' 'host process ($.process.run)'

# Every URL in runtime code must be on an allow-listed origin.
while IFS= read -r hit; do
  url="$(grep -oE 'https?://[A-Za-z0-9.:@-]+' <<<"$hit" | head -1)"
  ok=0; for o in $ALLOWED_ORIGINS; do [ "$url" = "$o" ] && ok=1; done
  [ "$ok" -eq 1 ] || { echo "$hit" >&2; err "URL outside the hub allow-list"; }
done < <(grep -rnoE 'https?://[A-Za-z0-9.:@-]+' "${code[@]}" || true)

# The token never goes to $.store: no store.set within 3 lines of "token".
if hits=$(grep -rniE -B3 -A3 'store\.set' "$src/mod" | grep -iE 'token' | grep -viE 'tokenSource|tokenFilePath'); then
  echo "$hits" >&2; err "\$.store.set near a token"
fi

# --- Secrets, private addresses and personal paths, anywhere in the plugin.
patterns='slk_[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9-]{20,}'
patterns+='|(AKIA|ASIA)[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,}'
patterns+='|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
patterns+='|192\.168\.[0-9]+\.[0-9]+|10\.[0-9]+\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+'
patterns+='|[A-Za-z0-9-]+\.(local|lan|ts\.net)([^A-Za-z0-9.-]|$|\.([^A-Za-z0-9]|$))'
patterns+='|/root/|/home/[A-Za-z0-9._-]+|/Users/[A-Za-z0-9._-]+|[A-Za-z]:(\\+|/)Users'
if hits=$(grep -rInE "$patterns" --exclude-dir=types "$root" 2>/dev/null); then
  echo "$hits" >&2; err "possible secret, private address, internal hostname or personal path"
fi

if [ "$fail" -eq 0 ]; then echo "check-sielay-link: OK ($root)"; fi
exit "$fail"
