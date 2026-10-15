#!/usr/bin/env bash
# Proves tools/check-sielay-link.sh fails on each violation it exists to catch:
# copies the plugin, plants one violation per case, and expects the gate to fail.
#   usage: bash tests/sielay-link/run-gate.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$ROOT/tools/check-sielay-link.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fails=0; cases=0

fresh() { rm -rf "$TMP/p"; cp -R "$ROOT/plugins/sielay-link" "$TMP/p"; rm -rf "$TMP/p/.claude-plugin/types"; }
expect_fail() { # name
  cases=$((cases+1))
  if bash "$GATE" "$TMP/p" >/dev/null 2>&1; then echo "FAIL $1 (gate passed)"; fails=$((fails+1)); else echo "ok   $1"; fi
}
plant() { # file text
  printf '\n%s\n' "$2" >> "$TMP/p/$1"
}
json_set() { # python expression over `pj` (plugin.json)
  python3 - "$TMP/p/.claude-plugin/plugin.json" "$1" <<'PY'
import json, sys
path, expr = sys.argv[1], sys.argv[2]
pj = json.load(open(path))
exec(expr)
json.dump(pj, open(path, "w"))
PY
}

fresh
cases=$((cases+1))
if bash "$GATE" "$TMP/p" >/dev/null 2>&1; then echo "ok   clean copy passes"; else echo "FAIL clean copy"; fails=$((fails+1)); fi

fresh; plant mod/link-tools.js "export const x = () => fetch('https://sielay.cloud')";              expect_fail "fetch outside the hub client"
fresh; plant mod/link-runtime.js 'export async function y($) { return $.process.run(["id"]) }';    expect_fail "process.run outside the adapter"
fresh; plant mod/link-runtime.js "export const u = 'https://evil.example/api'";                     expect_fail "URL outside the allow-list"
fresh; plant mod/link-hub-client.js "export const v = 'http://sielay.cloud'";                       expect_fail "http (not https) hub origin"
fresh; plant mod/link-runtime.js 'export async function z($) { await $.prompt.submit({ text: "x", asUser: true }) }'; expect_fail "asUser"
fresh; plant mod/link-band.jsx 'export const d = { dangerouslySetInnerHTML: 1 }';                   expect_fail "dangerouslySetInnerHTML"
fresh; plant mod/link-runtime.js 'export async function t($, token) { await $.store.set("k", token) }'; expect_fail "store.set near token"
fresh; plant mod/link-runtime.js "export const tok = 'slk_abcdefghijklmnop'";                        expect_fail "slk_ token-shaped literal"
fresh; plant mod/link-runtime.js 'export const e = (s) => eval(s)';                                  expect_fail "eval"
fresh; plant bin/sielay-link-socket-write.mjs "import cp from 'node:child_process'";                 expect_fail "child_process in the helper"
fresh; plant mod/link-runtime.js 'export async function c($) { await $.config.set({ key: "k", value: "v" }) }'; expect_fail "config.set"
fresh; plant README.md 'ver /home/alguien/.claude';                                                 expect_fail "personal path"
fresh; touch "$TMP/p/mod/extra.js";                                                                 expect_fail "unknown file"
fresh; json_set 'pj["userConfig"]["link_token"]["required"] = True';                               expect_fail "link_token required"
fresh; json_set 'pj["userConfig"]["link_token"]["sensitive"] = False';                             expect_fail "link_token not sensitive"
fresh; json_set 'pj["userConfig"]["hub_url"]["default"] = "https://evil.example"';                 expect_fail "hub_url default off the allow-list"
fresh; json_set 'pj["userConfig"]["extra"] = {"type": "string"}';                                   expect_fail "extra userConfig field"
fresh; echo '{"modules": ["../mod/other.js"]}' > "$TMP/p/hooks/hooks.json";                         expect_fail "hooks.json rewired"

# Evasions from the PR #10 review.
fresh; plant mod/link-runtime.js "export async function ev1(\$) { const s = ' //'; return \$.process.run(['id']) }"; expect_fail "a string holding // cannot hide a call"
fresh; plant mod/link-runtime.js "export async function ev2(\$) { const u = \`a\${'//'}b\`; return \$.process.run(['id']) }"; expect_fail "a template holding // cannot hide a call"
fresh; plant mod/link-runtime.js 'export async function ev3($) { return $["process"].run(["id"]) }';   expect_fail "bracket access on \$"
fresh; plant mod/link-runtime.js 'export async function ev4($) { return $.http["fetch"]("x") }';       expect_fail "bracket access on a noun"
fresh; plant mod/link-runtime.js 'export async function ev5($) { const { run } = $.process; return run(["id"]) }'; expect_fail "destructured noun"
fresh; plant mod/link-runtime.js 'export async function ev6($) { const p = $.process; return p }';    expect_fail "aliased noun"
fresh; plant mod/link-runtime.js 'export async function ev7($) { await $.fs.write("/x", "y") }';        expect_fail "\$.fs.write"
fresh; plant mod/link-runtime.js 'export const ev8 = { socketPath: "/x" }';                              expect_fail "socketPath"

# Engine call list (--engine): calls no text rule knows, read by the engine's parser.
if command -v claude >/dev/null 2>&1; then
  expect_fail_engine() { # name
    cases=$((cases+1))
    if bash "$GATE" --engine "$TMP/p" >/dev/null 2>&1; then echo "FAIL $1 (gate passed)"; fails=$((fails+1)); else echo "ok   $1"; fi
  }
  fresh; cases=$((cases+1))
  if bash "$GATE" --engine "$TMP/p" >/dev/null 2>&1; then echo "ok   clean copy passes --engine"; else echo "FAIL clean copy --engine"; fails=$((fails+1)); fi
  # The engine lists only calls reachable from a hook (code that can run), so
  # each case is planted inside startLink, which session.start reaches.
  plant_in_start() { python3 - "$TMP/p/mod/link-runtime.js" "$1" <<'PY2'
import sys
path, line = sys.argv[1], sys.argv[2]
s = open(path).read()
head = "export async function startLink($, rt) {\n"
assert head in s
open(path, "w").write(s.replace(head, head + "  " + line + "\n", 1))
PY2
  }
  fresh; plant_in_start 'await $.audio.speak("hola")';                     expect_fail_engine "--engine: a \$ call off the allow-list"
  fresh; plant_in_start 'await $.agent.list()';                            expect_fail_engine "--engine: another \$ call off the allow-list"
  fresh; plant_in_start 'await $.prompt.submit({ text: "x" })';             expect_fail_engine "--engine: prompt.submit outside the adapter"
else
  echo "skip --engine cases (claude not on the PATH)"
fi

echo "gate cases: $((cases-fails))/$cases ok"
[ "$fails" -eq 0 ]
