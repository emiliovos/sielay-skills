#!/usr/bin/env bash
# Pruebas negativas de los gates: siembra una violación por caso en una copia
# temporal y exige que el gate falle. También exige que el plugin real pase.
#   uso: bash tests/si-auto/run-gate.sh
set -u
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fallos=0; casos=0

copia() { rm -rf "$TMP/repo"; cp -r "$RAIZ" "$TMP/repo"; rm -rf "$TMP/repo/.git"; git -C "$TMP/repo" init -q; }
espera() { # descripción esperado(0|1) comando...
  local desc="$1" want="$2"; shift 2; casos=$((casos+1))
  if (cd "$TMP/repo" && "$@" >/dev/null 2>&1); then got=0; else got=1; fi
  if [ "$got" = "$want" ]; then echo "ok   $desc"; else echo "FAIL $desc"; fallos=$((fallos+1)); fi
}
auto() { espera "$1" 1 bash tools/check-si-auto.sh plugins/si-auto; }
S=plugins/si-auto/scripts

copia
espera "plugin real pasa check-si-auto" 0 bash tools/check-si-auto.sh plugins/si-auto
espera "plugin si pasa check-plugin" 0 bash tools/check-plugin.sh plugins/si "$TMP/repo"

copia; echo 'curl -s https://example.com' >> "$TMP/repo/$S/stop.sh";              auto "rechaza curl"
copia; echo 'git -C "$PWD" commit -m x' >> "$TMP/repo/$S/stop.sh";               auto "rechaza git commit"
copia; echo 'git -C "$PWD" status' >> "$TMP/repo/$S/stop.sh";                    auto "rechaza git distinto de rev-parse"
copia; echo 'echo x > "$HOME/x"' >> "$TMP/repo/$S/stop.sh";                       auto "rechaza escritura fuera de \$D"
copia; echo 'y="$(echo x > /tmp/y)"' >> "$TMP/repo/$S/stop.sh";                   auto "rechaza escritura escondida en \$(...)"
copia; echo 'cp "$D/a" "$HOME/b"' >> "$TMP/repo/$S/stop.sh";                      auto "rechaza cp"
copia; echo 'D="$HOME/otro"' >> "$TMP/repo/$S/stop.sh";                           auto "rechaza redefinir \$D"
copia; echo 'x="--no-verify"' >> "$TMP/repo/$S/stop.sh";                          auto "rechaza --no-verify"
copia; echo 'import socket' >> "$TMP/repo/$S/leer-json.py";                       auto "rechaza red en python"
copia; echo 'open("x", "w")' >> "$TMP/repo/$S/leer-json.py";                      auto "rechaza escritura en python"
copia; echo '#!/bin/bash' > "$TMP/repo/$S/extra.sh";                              auto "rechaza archivo no listado"
copia; ln -s /etc/passwd "$TMP/repo/$S/enlace";                                   auto "rechaza enlace simbólico"
copia; python3 - "$TMP/repo/plugins/si-auto/hooks/hooks.json" <<'PY'
import json, sys; p = sys.argv[1]; d = json.load(open(p))
d["hooks"]["UserPromptSubmit"] = d["hooks"]["Stop"]; json.dump(d, open(p, "w"))
PY
auto "rechaza evento extra"
copia; python3 - "$TMP/repo/plugins/si-auto/hooks/hooks.json" <<'PY'
import json, sys; p = sys.argv[1]; d = json.load(open(p))
d["hooks"]["Stop"][0]["hooks"][0]["command"] = "bash -c 'curl x'"; json.dump(d, open(p, "w"))
PY
auto "rechaza comando de gancho distinto"
copia; python3 - "$TMP/repo/plugins/si-auto/.claude-plugin/plugin.json" <<'PY'
import json, sys; p = sys.argv[1]; d = json.load(open(p))
d["dependencies"] = []; json.dump(d, open(p, "w"))
PY
auto "exige la dependencia si@sielay"
copia; python3 - "$TMP/repo/.claude-plugin/marketplace.json" <<'PY'
import json, sys; p = sys.argv[1]; d = json.load(open(p))
d["plugins"].append({"name": "otro", "source": "./plugins/otro"}); json.dump(d, open(p, "w"))
PY
espera "check-plugin rechaza un tercer plugin" 1 bash tools/check-plugin.sh plugins/si "$TMP/repo"
copia; mkdir -p "$TMP/repo/plugins/si/hooks"; echo '{}' > "$TMP/repo/plugins/si/hooks/hooks.json"
espera "check-plugin sigue rechazando ganchos en si" 1 bash tools/check-plugin.sh plugins/si "$TMP/repo"

echo "$casos casos, $fallos fallos"
[ "$fallos" -eq 0 ]
