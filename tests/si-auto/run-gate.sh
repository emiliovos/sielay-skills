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
# Casos con los que la revisión de código burló la primera versión del gate.
siembra() { printf '%s\n' "$1" >> "$TMP/repo/$S/${2:-stop.sh}"; }
copia; siembra 'sed -i "s/x/y/" "$raiz/CLAUDE.md"';                  auto "rechaza sed -i"
copia; siembra "python3 -c 'print(1)'";                               auto "rechaza python3 -c"
copia; siembra "bash -c 'true'";                                      auto "rechaza bash -c"
copia; siembra "perl -e 'print 1'";                                   auto "rechaza perl"
copia; siembra 'x=$(( $(rm -f "$raiz/CLAUDE.md") + 1 ))';             auto "rechaza \$(...) dentro de \$((...))"
copia; printf 'cat <<FIN\n$(rm -f "$raiz/CLAUDE.md")\nFIN\n' >> "$TMP/repo/$S/stop.sh"; auto "rechaza heredoc sin comillas"
copia; siembra 'read -r D <<<"$HOME"';                                auto "rechaza read que asigna D"
copia; siembra 'SESION="../../x"';                                    auto "rechaza reasignar SESION"
copia; siembra 'm="$raiz/README.md"; rm -f "$m"';                     auto "rechaza rm con variable redirigida"
copia; siembra '$(printf %s gi t) -C . commit';                       auto "rechaza git ofuscado"
copia; siembra 'import subprocess' leer-json.py;                      auto "rechaza import subprocess"
copia; siembra 'import pathlib' leer-json.py;                         auto "rechaza pathlib"
copia; siembra 'pathlib.Path("x").write_text("y")' leer-json.py;      auto "rechaza write_text"
copia; siembra 'printf -v D "%s" "$HOME"';                            auto "rechaza printf -v"
copia; siembra 'awk '"'"'{ print > "/tmp/x" }'"'"' "$D/bitacora.log"'; auto "rechaza awk que escribe"
copia; siembra 'echo x | tee "$HOME/x"';                              auto "rechaza tee"
copia; siembra 'poner_meta "$raiz/CLAUDE.md" x y';                     auto "rechaza poner_meta fuera de \$D"
copia; siembra 'f() { printf x > "$1.tmp.$$" && mv "$1.tmp.$$" "$1"; }'; auto "rechaza funciones nuevas"
copia; siembra 'poner_meta() { :; }';                                  auto "rechaza redefinir una función fuera de comun.sh"
copia; siembra 'poner_meta() { :; }' comun.sh;                         auto "rechaza definir dos veces la misma función"
copia; siembra 'bitacora2() { :; }' comun.sh;                          auto "rechaza funciones no listadas en comun.sh"
copia; siembra 'printf x > "$1.tmp.$$"';                               auto "rechaza escribir con \$1 fuera de poner_meta"
copia; siembra 'PATH="/tmp" python3 "$AQUI/leer-json.py" "$@"';        auto "rechaza cambiar PATH"
copia; siembra 'GIT_DIR="/tmp/x" git -C "$1" rev-parse --show-toplevel'; auto "rechaza cambiar GIT_DIR"
copia; siembra 'local -n x=D';                                         auto "rechaza local -n"
copia; siembra 'x = __builtins__' leer-json.py;                        auto "rechaza __builtins__"
copia; siembra 'x = sys.modules' leer-json.py;                         auto "rechaza sys.modules"
copia; siembra 'open(*["x", "w"])' leer-json.py;                       auto "rechaza open con *args"
copia; siembra 'open("x", **{"mode": "w"})' leer-json.py;              auto "rechaza open con **kwargs"
copia; siembra 'abrir = open' leer-json.py;                            auto "rechaza guardar open en otra variable"
copia; siembra "x=\$'a\\'b'; echo x > \"\$HOME/y\"";                     auto "\$'...' con comilla escapada no desalinea el análisis"

# Casos del intento manual de burlar el gate (lecturas de secretos, variables que
# controlan rutas y ejecución escondida en valores de variables). Formato: archivo|línea.
while IFS='|' read -r archivo linea; do
  [ -n "$archivo" ] || continue
  copia; siembra "$linea" "$archivo"; auto "rechaza [$archivo] $linea"
done <<'CASOS'
stop.sh|y="${x:-$(touch "$HOME/a")}"
stop.sh|y="${x:-`touch a`}"
stop.sh|cat "$HOME/.ssh/id_rsa"
stop.sh|cat "$RAIZ/.env" >> "$D/bitacora.log"
stop.sh|bitacora x "$(cat "$RAIZ/.env")"
stop.sh|leer_meta "$RAIZ/.env" API_KEY
stop.sh|tail -n 5 "$HOME/.bash_history"
stop.sh|grep -r token "$HOME"
stop.sh|sed -n 's/^x=//p' "$RAIZ/.env"
stop.sh|awk -f "$HOME/prog.awk" "$1/CLAUDE.md"
stop.sh|date -f "$HOME/.ssh/id_rsa"
stop.sh|ls "$HOME/.ssh"
stop.sh|ps -o args= -e
stop.sh|cd "$HOME" && cat id_rsa
stop.sh|echo x 1<> "$HOME/a"
stop.sh|cat < /etc/passwd
stop.sh|read -r m < "$HOME/.ssh/id_rsa"
stop.sh|mapfile -t CAMPOS < "$RAIZ/.env"
stop.sh|py ediciones "$HOME/.ssh/id_rsa" 0
leer-json.py|print(open("/etc/passwd").read())
leer-json.py|help()
leer-json.py|sys.stdin = open("/etc/passwd")
session-start.sh|for m in "$RAIZ/CLAUDE.md"; do mv "$m" "$D/entregadas/$id.meta"; done
session-start.sh|read -r m <<<"$RAIZ/CLAUDE.md"
session-start.sh|while IFS= read -r m; do mv "$m" "$D/entregadas/$id.meta"; done <<<"$RAIZ/CLAUDE.md"
session-start.sh|while IFS= read -r m; do mv "$m" "$D/entregadas/$id.meta"; done < <(echo "$RAIZ/CLAUDE.md")
stop.sh|while IFS=$'\t' read -r id valor; do poner_meta "$D/entregadas/$id.meta" x y; done <<<"../../../x z"
stop.sh|for id in ../../x; do mv "$D/$id.md" "$D/entregadas/$id.md"; done
ver-notas.sh|for n in "$RAIZ/a.md"; do m="${n%.md}.meta"; done
stop.sh|veredictos="../../x integrada"
stop.sh|x='$(touch a)'; echo "${x@P}"
stop.sh|x='a[$(touch b)]'; [[ $x -gt 0 ]]
stop.sh|t='a[$(touch b)]'
stop.sh|ref='a[$(touch b)]'
session-start.sh|inicio='a[$(touch b)]'
comun.sh|UMBRAL_MIN='a[$(touch b)]'
stop.sh|x='a[$(touch b)]'; y=$(( x + 1 ))
stop.sh|x='a[$(touch b)]'; [ $(( x )) -gt 0 ]
stop.sh|x='a[$(touch b)]'; echo "${!x}"
stop.sh|y='a[$(touch b)]'; echo "${SESION:y}"
stop.sh|y='a[$(touch b)]'; echo "${CAMPOS[y]}"
stop.sh|y='a[$(touch b)]'; echo "${CAMPOS[$y]}"
CASOS

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
