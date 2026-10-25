#!/usr/bin/env bash
# Safety gate for the `sielay-link` plugin. Runs in CI and before every release.
# The plugin runs inside sessions that may be in bypassPermissions and carries a
# hub token, so the gate is an allow-list: known files only, the exact manifest
# and hook wiring, the hub origin allow-list, network calls only in the hub
# client, host processes only in the delivery adapter, and no secrets.
#
# The text rules below are defence in depth, not a proof: a determined author
# can always write code a grep does not read. With --engine (needs `claude` on
# the PATH; CI runs it after installing Claude Code) the gate also reads the
# `$` calls the engine's own parser reports for the module, which follows `$`
# through every function, and allow-lists them exactly. The engine already
# refuses `$` written any other way than `$.noun.event(...)` (no brackets, no
# destructuring, no passing a noun around), so that list is complete.
#
#   usage: tools/check-sielay-link.sh [--engine] [plugin-dir]
set -euo pipefail

fail=0
err() { echo "ERROR: $*" >&2; fail=1; }

engine=0
if [ "${1:-}" = "--engine" ]; then engine=1; shift; fi
root="${1:-plugins/sielay-link}"
[ -d "$root" ] || { echo "ERROR: plugin dir not found: $root" >&2; exit 1; }
root="$(cd "$root" && pwd -P)"
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required" >&2; exit 1; }

ALLOWED_ORIGINS='https://sielay.cloud https://sielay.vostec.mx'

# --- Exact file allow-list; no symlinks. `.claude-plugin/types/` and the top-level
# `tsconfig.json` are what the engine lays beside a mod it loads from a folder
# (both git-ignored), so they are skipped.
allowed=".gitignore .claude-plugin .claude-plugin/plugin.json .mcp.json hooks hooks/hooks.json bin
bin/sielay-link-socket-write.mjs bin/sielay-mcp-headers.mjs bin/sielay-mcp-headers.sh types types/index.d.ts README.md tests tests/sielay-link-mod.test.ts
mod mod/sielay-link-mod.js mod/link-band.jsx mod/link-pane.jsx mod/link-commands.js mod/link-delivery-adapter.js
mod/link-hub-client.js mod/link-inbound-framing.js mod/link-inbound-handler.js mod/link-launch-mode.js mod/link-mode-freshness.js
mod/link-pairing.js mod/link-poll-loop.js mod/link-run-gate.js mod/link-runtime.js mod/link-session-name-resolution.js
mod/link-session-payload.js mod/link-state-refs.js mod/link-tools.js mod/link-inbound-store.js mod/link-strip-selection.js mod/link-instance-identity.js
mod/link-build-tool.js mod/link-build-state.js mod/link-build-hooks.js mod/link-build-validate.js mod/link-build-fields.js mod/link-build-estimate.js mod/link-build-waiting-retro.js mod/link-tool-messages.js mod/link-tool-address.js mod/link-session-repo.js mod/link-hub-notice-framing.js mod/link-watch-tool.js mod/link-tool-specs.js mod/link-secret-scrub.js
mod/link-discovery-context.js mod/link-session-end.js mod/link-build-open.js"
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
    mj = json.load(open(f"{root}/.mcp.json", encoding="utf-8"))
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
# The only MCP server is sielay's, on the hub, authenticated by the plugin's own helper.
want_mcp = {"mcpServers": {"sielay": {"type": "http", "url": "https://sielay.cloud/mcp",
            "headersHelper": 'sh "${CLAUDE_PLUGIN_ROOT}/bin/sielay-mcp-headers.sh"'}}}
if mj != want_mcp:
    out.append(".mcp.json: must be exactly the sielay server on https://sielay.cloud/mcp with bin/sielay-mcp-headers.sh")
print("\n".join(out))
PY
); then :; else err "manifest check could not run"; fi
if [ -n "$out" ]; then echo "$out" | sed 's/^/ERROR: /' >&2; fail=1; fi

# --- Runtime code rules (mod/ and bin/; the engine test file is exempt). They
# run on a copy with comments stripped, so prose and JSDoc types never match.
# The stripper tracks strings and template literals (nested `${}` included):
# `//` inside a string is never taken for a comment, so `' //'; $.process.run()`
# cannot hide a call. When unsure it keeps the text (a false alarm, never a miss).
src="$(mktemp -d)"; trap 'rm -rf "$src"' EXIT
python3 - "$root" "$src" <<'PY'
import pathlib, sys
root, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

def strip_comments(text):
    out, i, n = [], 0, len(text)
    stack = ["code"]          # code | ' | " | ` ; code entries inside `${}` carry a brace depth
    depth = [0]
    while i < n:
        c, nxt, mode = text[i], text[i + 1] if i + 1 < n else "", stack[-1]
        if mode == "code":
            if c == "/" and nxt == "/":
                j = text.find("\n", i)
                i = n if j < 0 else j
                continue
            if c == "/" and nxt == "*":
                j = text.find("*/", i + 2)
                chunk = text[i:] if j < 0 else text[i:j + 2]
                out.append("\n" * chunk.count("\n"))
                i += len(chunk)
                continue
            if c in "'\"`":
                stack.append(c); depth.append(0)
            elif c == "{":
                depth[-1] += 1
            elif c == "}":
                if depth[-1] == 0 and len(stack) > 1:
                    stack.pop(); depth.pop()      # end of a `${...}` back into its template
                else:
                    depth[-1] -= 1
            out.append(c); i += 1
            continue
        if c == "\\":
            out.append(text[i:i + 2]); i += 2
            continue
        if mode == "`" and c == "$" and nxt == "{":
            out.append("${"); i += 2
            stack.append("code"); depth.append(0)
            continue
        if c == mode or (c == "\n" and mode in "'\""):
            stack.pop(); depth.pop()
        out.append(c); i += 1
    return "".join(out)

for sub in ("mod", "bin"):
    for f in sorted((root / sub).rglob("*")):
        if not f.is_file():
            continue
        out = dst / f.relative_to(root)
        out.parent.mkdir(parents=True, exist_ok=True)
        text = f.read_text(encoding="utf-8")
        # Shell is not JS: an unquoted URL's `//` would read as a comment, so .sh is copied as is.
        out.write_text(text if f.suffix == ".sh" else strip_comments(text), encoding="utf-8")
PY
code=("$src/mod" "$src/bin")
only_in() { # pattern allowed-file[,allowed-file...] description
  local hits f
  hits=$(grep -rnE "$1" "${code[@]}" || true)
  for f in ${2//,/ }; do hits=$(grep -v "^$src/$f:" <<<"$hits" || true); done
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
forbid '\$\s*\[|\$\.[A-Za-z]+\s*\[|\$\?\.' '$ must be spelled $.noun.event(...): no brackets or optional chaining'
forbid '\}\s*=\s*\$\b|=\s*\$\.[A-Za-z]+\s*[;,)]|=\s*\$\s*[;,)]' 'no destructuring of $ or aliasing a noun of $'
forbid 'fs\.write|socketPath' '$.fs.write and socket fetches are not used'
# The MCP headersHelper is the other network caller: one POST to the hub's /api/up/mcp-token,
# with fetch (Node) or curl (bin/sielay-mcp-headers.sh, when Node is missing; the file
# allow-list keeps it the only shell script, and the JS cannot spawn processes).
only_in 'fetch\(' 'mod/link-hub-client.js,bin/sielay-mcp-headers.mjs' 'network call (fetch)'

# The two helpers run on every MCP connection, outside the engine's `$` model (--engine never sees
# them) and the shell one outside every JS text rule. So they are pinned: any change to either has to
# update its sha256 here, in the same reviewed PR. The JS helper may also import only node:fs,
# node:os and node:path, and never reach a module loader, vm, workers or native code.
for pin in "bin/sielay-mcp-headers.sh=0fa5239a364e89f4363f334ea10679b050b938372d18965f8fe48d462edd4073" "bin/sielay-mcp-headers.mjs=d16d9bb1c548ef7a8f5bea67e105b0282c378e7ebd50781466cf852439726944"; do
  f="${pin%%=*}"; want="${pin#*=}"
  got=$(python3 -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$root/$f" 2>/dev/null || true)
  [ "$got" = "$want" ] || err "$f changed (sha256 $got): review it and update its pin in tools/check-sielay-link.sh"
done
if hits=$(grep -nE '^[[:space:]]*import\b|\bimport[[:space:]]*\(' "$src/bin/sielay-mcp-headers.mjs" | grep -vE "^[0-9]+:import \{ [A-Za-z, ]+ \} from 'node:(fs|os|path)'$"); then
  echo "$hits" >&2; err "bin/sielay-mcp-headers.mjs may only import from node:fs, node:os and node:path"
fi
forbid 'createRequire|getBuiltinModule|node:(vm|module|worker_threads|child_process)|process\.(binding|dlopen|execve)|\bWorker\b' 'module loaders, vm, workers and native code are forbidden'
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

# --- Engine call list (--engine): the exact `$` calls, and who makes them.
# The engine caps that note near 1000 characters, and most of it is the "via"
# function names, so on the plugin as written the cut can hide `$` names. The
# names are read instead from a scratch copy where every function the module
# declares has a short name (renamed everywhere alike, so the call graph is the
# same); the check compares only the `$.noun.event` names, mapping the via
# names back for the three calls bound to one function. If even that note is
# cut, the gate fails closed.
if [ "$engine" -eq 1 ]; then
  command -v claude >/dev/null 2>&1 || { echo "ERROR: --engine needs claude on the PATH" >&2; exit 1; }
  if ! claude plugin validate --json "$root" >"$src/report.json" 2>/dev/null; then err "claude plugin validate failed"; fi
  short="$src/short"
  cp -R "$root" "$short"; rm -rf "$short/.claude-plugin/types" "$short/tsconfig.json"
  if ! python3 - "$short" "$src/names.json" <<'PY'
import json, pathlib, re, sys
root, out = pathlib.Path(sys.argv[1]), sys.argv[2]
files = sorted(p for p in (root / "mod").rglob("*") if p.suffix in (".js", ".jsx"))
code = {p: p.read_text(encoding="utf-8") for p in files}

def code_spans(text):
    """(is_code, chunk) pieces: strings, template text and comments are never code."""
    spans, buf, i, n = [], [], 0, len(text)
    stack, depth = ["code"], [0]
    def flush(kind):
        if buf: spans.append((kind, "".join(buf))); buf.clear()
    while i < n:
        c, nxt, mode = text[i], text[i + 1] if i + 1 < n else "", stack[-1]
        if mode == "code":
            if c == "/" and nxt in "/*":
                j = text.find("\n" if nxt == "/" else "*/", i + 2)
                j = n if j < 0 else (j if nxt == "/" else j + 2)
                flush(True); spans.append((False, text[i:j])); i = j; continue
            if c in "'\"`":
                flush(True); stack.append(c); depth.append(0); buf.append(c); i += 1; continue
            if c == "{": depth[-1] += 1
            elif c == "}":
                if depth[-1] == 0 and len(stack) > 1:
                    flush(True); stack.pop(); depth.pop(); buf.append(c); i += 1; continue
                depth[-1] -= 1
            buf.append(c); i += 1; continue
        if c == "\\":
            buf.append(text[i:i + 2]); i += 2; continue
        if mode == "`" and c == "$" and nxt == "{":
            buf.append("${"); flush(False); stack.append("code"); depth.append(0); i += 2; continue
        buf.append(c); i += 1
        if c == mode or (c == "\n" and mode in "'\""):
            flush(False); stack.pop(); depth.pop()
    flush(stack[-1] == "code")
    return spans

pieces = {p: code_spans(t) for p, t in code.items()}
code_only = "\n".join(chunk for sp in pieces.values() for is_code, chunk in sp if is_code)
everything = "\n".join(code.values())
declared = set(re.findall(r"\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)", code_only))
declared |= set(re.findall(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>", code_only))
engine_words = {w for pair in re.findall(r"\$\.(\w+)(?:\.(\w+))?", everything) for w in pair if w}
names = sorted(n for n in declared - engine_words - {"register"} if len(n) > 3)
mapping = {}
for i, n in enumerate(names):
    alias = f"Zq{i}"
    assert not re.search(rf"\b{alias}\b", everything), alias
    mapping[n] = alias
if mapping:
    rx = re.compile(r"(?<![\w$])(" + "|".join(map(re.escape, sorted(mapping, key=len, reverse=True))) + r")(?![\w$])")
    for p, sp in pieces.items():
        p.write_text("".join(rx.sub(lambda m: mapping[m.group(1)], c) if k else c for k, c in sp), encoding="utf-8")
json.dump({v: k for k, v in mapping.items()}, open(out, "w"))
PY
  then err "could not prepare the engine call list"; fi
  if ! report="$(claude plugin validate --json "$short" 2>/dev/null)"; then err "claude plugin validate failed on the scratch copy"; fi
  if out=$(python3 -c '
import json, re, sys
report = json.loads(sys.stdin.read())
back = json.load(open(sys.argv[1]))
original = json.load(open(sys.argv[2]))
# The renaming must not change what the engine sees: every other note (hooks,
# state and env reads and writes) is the same as on the plugin as written.
others = lambda r: [n for c in r.get("contents", []) for n in c.get("notes", []) if " calls: " not in n]
if others(report) != others(original):
    print("the scratch copy reads differently from the plugin: cannot trust its call list"); sys.exit()
notes = [n for c in report.get("contents", []) for n in c.get("notes", []) if " calls: " in n]
if len(notes) != 1:
    print("expected exactly one calls: note from the engine"); sys.exit()
text = notes[0].split(" calls: ", 1)[1]
if "…" in text:
    print("the engine call list is cut even with short names: cannot check it whole"); sys.exit()
allowed = {
    "$.clock.after", "$.clock.now", "$.command.register", "$.env.get", "$.fs.exists", "$.fs.read",
    "$.session.cwd", "$.session.id", "$.session.root", "$.settings.read", "$.state.get", "$.state.set", "$.store.get", "$.store.set",
    "$.tool.register", "$.ui.log", "$.ui.open", "$.ui.resolve", "$.ui.toast",
}
only_via = {"$.http.fetch": {"createHubClient"}, "$.process.run": {"createDeliveryAdapter"}, "$.prompt.submit": {"createDeliveryAdapter"}}
calls = {}
for noun, via in re.findall(r"(\$\.[a-z]+\.[a-z]+)(?: \(via ([^)]*)\))?", text):
    calls[noun] = {back.get(v.strip(), v.strip()) for v in via.split(",") if v.strip()}
out = [f"{n} is not on the allow-list of $ calls" for n in sorted(set(calls) - allowed - set(only_via))]
for noun, vias in only_via.items():
    if noun not in calls: out.append(f"{noun} missing from the engine call list")
    elif calls[noun] != vias: out.append(f"{noun} must be called only via {sorted(vias)} (got {sorted(calls[noun])})")
print("\n".join(out))
' "$src/names.json" "$src/report.json" <<<"$report"); then :; else err "engine call check could not run"; fi
  if [ -n "$out" ]; then echo "$out" | sed 's/^/ERROR: /' >&2; fail=1; fi
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
