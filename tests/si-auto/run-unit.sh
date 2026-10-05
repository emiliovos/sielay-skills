#!/usr/bin/env bash
# Pruebas unitarias de los ganchos de si-auto. No usan Claude ni red: alimentan
# cada script con el JSON que mandaría Claude Code y revisan el resultado.
# En TODOS los casos se exige que `git status --porcelain` del repo no cambie.
#   uso: bash tests/si-auto/run-unit.sh
set -u
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
S="$RAIZ/plugins/si-auto/scripts"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fallos=0; casos=0
ok()   { casos=$((casos+1)); echo "ok   $1"; }
mal()  { casos=$((casos+1)); fallos=$((fallos+1)); echo "FAIL $1${2:+ — $2}"; }
check(){ if eval "$2"; then ok "$1"; else mal "$1" "${3:-}"; fi; }

CONTRATO=$'# Repo\n\n## Cierre de sesión\n- Estado: docs/estado.md\n- Push: main directo\n- Handoff: pantalla\n- Automático: sí\n\n## Otra sección\n'
nuevo_repo() { # nombre [contenido-CLAUDE.md]
  local r="$TMP/$1"; mkdir -p "$r" && git -C "$r" init -q
  printf '%s' "${2-$CONTRATO}" > "$r/CLAUDE.md"; echo x > "$r/a.txt"
  git -C "$r" add -A && git -C "$r" -c user.email=t@t -c user.name=t commit -qm i
  echo "$r"
}
notas() { echo "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)/si-auto"; }
gancho() { # script repo sesion [json-extra]  → stdout del gancho
  local extra="${4:-}"
  printf '{"session_id":"%s","cwd":"%s","transcript_path":"%s"%s}' "$3" "$2" "$TMP/$3.jsonl" "${extra:+,$extra}" |
    (cd "$2" && bash "$S/$1")
}
transcript_con_edicion() { # sesion  → una edición con fecha de ahora
  printf '{"type":"assistant","timestamp":"%s","message":{"content":[{"type":"tool_use","name":"Edit","input":{}}]}}\n' \
    "$(date -u +%FT%T.000Z)" >> "$TMP/$1.jsonl"
}
envejecer() { # meta clave segundos → resta segundos a una marca de tiempo
  local v; v="$(sed -n "s/^$2=//p" "$1")"; sed -i "s/^$2=.*/$2=$((v - $3))/" "$1"
}
status_igual() { [ "$(git -C "$1" status --porcelain)" = "" ]; }

# --- Contrato
r="$(nuevo_repo sin-contrato "# Repo sin sección")"
out="$(gancho stop.sh "$r" s1 '"stop_hook_active":false')"
check "sin contrato: silencio y nada en disco" '[ -z "$out" ] && [ ! -d "$(notas "$r")" ] && status_igual "$r"'

r="$(nuevo_repo apagado "${CONTRATO/Automático: sí/Automático: no}")"
gancho session-start.sh "$r" s1 '"source":"startup"' >/dev/null
check "Automático: no → nada en disco" '[ ! -d "$(notas "$r")" ]'

r="$(nuevo_repo off)"
out="$(SI_AUTO_OFF=1 gancho session-start.sh "$r" s1 '"source":"startup"')"
check "SI_AUTO_OFF=1 → nada en disco" '[ -z "$out" ] && [ ! -d "$(notas "$r")" ]'

r="$(nuevo_repo cada "${CONTRATO/Automático: sí/Automático: sí, cada 5 min}")"
check "lee 'sí, cada N min'" '[ "$(bash -c ". \"$S/comun.sh\"; umbral_del_contrato \"$r\"")" = 5 ]'
r2="$(nuevo_repo otra-redaccion "${CONTRATO/Automático: sí/Automático: si}")"
check "otra redacción cuenta como no" '[ -z "$(bash -c ". \"$S/comun.sh\"; umbral_del_contrato \"$r2\"")" ]'

# --- Stop
r="$(nuevo_repo stop)"; D="$(notas "$r")"
gancho session-start.sh "$r" s1 '"source":"startup"' >/dev/null
out="$(gancho stop.sh "$r" s1 '"stop_hook_active":false')"
check "Stop antes del umbral: no bloquea" '[ -z "$out" ]'
envejecer "$D/s1.meta" inicio 1900
out="$(gancho stop.sh "$r" s1 '"stop_hook_active":false')"
check "Stop con umbral sin ediciones: no bloquea" '[ -z "$out" ]'
transcript_con_edicion s1
out="$(gancho stop.sh "$r" s1 '"stop_hook_active":false')"
check "Stop con umbral y edición: bloquea" 'grep -q "\"decision\": \"block\"" <<<"$out" && grep -q "si-auto-nota" <<<"$out"'
out="$(gancho stop.sh "$r" s1 '"stop_hook_active":false')"
check "segundo Stop sin cambios: no vuelve a bloquear" '[ -z "$out" ]'
out="$(gancho stop.sh "$r" s1 '"stop_hook_active":true,"last_assistant_message":"Listo.\n<si-auto-nota>\nhice X\nsigue Y\n</si-auto-nota>\n¿Seguimos?"')"
check "stop_hook_active: no bloquea y guarda la nota" '[ -z "$out" ] && [ "$(cat "$D/s1.md")" = $'"'"'hice X\nsigue Y'"'"' ]'
check "nota guardada actualiza ultima_nota" 'grep -q "^ultima_nota=" "$D/s1.meta"'
gancho stop.sh "$r" s1 '"stop_hook_active":true,"last_assistant_message":"sin marcas"' >/dev/null
check "bloqueo sin nota queda en bitácora" 'grep -q "bloqueo-sin-nota" "$D/bitacora.log"'
check "bitácora sin contenido de notas" '! grep -q "hice X" "$D/bitacora.log"'
check "Stop: git status idéntico" 'status_igual "$r"'

# --- SessionEnd y entrega en SessionStart
gancho session-end.sh "$r" s1 '"reason":"prompt_input_exit"' >/dev/null
check "SessionEnd marca terminada" 'grep -q "^terminada=.*prompt_input_exit" "$D/s1.meta"'
out="$(gancho session-start.sh "$r" s2 '"source":"startup"')"
check "SessionStart entrega la nota terminada" 'grep -q "hice X" <<<"$out" && grep -q "additionalContext" <<<"$out" && grep -q "si-auto-veredicto" <<<"$out"'
check "nota movida a entregadas con a quién y cuándo" '[ -f "$D/entregadas/s1.md" ] && [ ! -f "$D/s1.md" ] && grep -q "^entregada_a=s2" "$D/entregadas/s1.meta" && grep -q "^entregada_en=" "$D/entregadas/s1.meta"'
out="$(gancho session-start.sh "$r" s3 '"source":"startup"')"
check "no se entrega dos veces" '! grep -q "hice X" <<<"$out"'
gancho stop.sh "$r" s2 '"stop_hook_active":false,"last_assistant_message":"<si-auto-veredicto nota=\"s1\">integrada</si-auto-veredicto>"' >/dev/null
check "veredicto queda en la marca de entregada" 'grep -q "^veredicto=integrada" "$D/entregadas/s1.meta"'
gancho stop.sh "$r" s3 '"stop_hook_active":false,"last_assistant_message":"<si-auto-veredicto nota=\"s1\">parcial</si-auto-veredicto>"' >/dev/null
check "veredicto de otra sesión se ignora" 'grep -q "^veredicto=integrada" "$D/entregadas/s1.meta"'
gancho stop.sh "$r" s2 '"stop_hook_active":false,"last_assistant_message":"<si-auto-veredicto nota=\"../x\">integrada</si-auto-veredicto>"' >/dev/null
check "veredicto con id inválido se ignora" '[ ! -e "$D/x.meta" ] && [ ! -e "$(dirname "$D")/x.meta" ]'

# --- Sesión viva vs muerta
r="$(nuevo_repo pid)"; D="$(notas "$r")"; mkdir -p "$D/entregadas"
printf 'inicio=%s\npid=%s\n' "$(date -u +%s)" "$$" > "$D/viva.meta"; echo "nota viva" > "$D/viva.md"
muerto="$(bash -c 'echo $$')"   # PID de un proceso que ya terminó
printf 'inicio=%s\npid=%s\n' "$(date -u +%s)" "$muerto" > "$D/muerta.meta"; echo "nota muerta" > "$D/muerta.md"
out="$(gancho session-start.sh "$r" nueva '"source":"startup"')"
check "PID vivo sin terminada: no se entrega" '! grep -q "nota viva" <<<"$out" && [ -f "$D/viva.md" ]'
check "PID muerto sin terminada: se entrega" 'grep -q "nota muerta" <<<"$out"'
printf 'inicio=%s\nterminada=1 other\n' "$(date -u +%s)" > "$D/sin-nota.meta"
gancho session-start.sh "$r" otra '"source":"startup"' >/dev/null
check "sesión terminada sin nota: se limpia" '[ ! -f "$D/sin-nota.meta" ]'

# --- Dos arranques simultáneos con una nota
r="$(nuevo_repo carrera)"; D="$(notas "$r")"; mkdir -p "$D/entregadas"
printf 'inicio=1\nterminada=1 other\n' > "$D/vieja.meta"; echo "nota única" > "$D/vieja.md"
gancho session-start.sh "$r" a1 '"source":"startup"' > "$TMP/o1" & gancho session-start.sh "$r" a2 '"source":"startup"' > "$TMP/o2" & wait
check "dos arranques simultáneos: se entrega una sola vez" '[ "$(cat "$TMP/o1" "$TMP/o2" | grep -c "nota única")" = 1 ]'

# --- Compactación
r="$(nuevo_repo compact)"; D="$(notas "$r")"
gancho pre-compact.sh "$r" c1 '"trigger":"auto"' >/dev/null
out="$(gancho session-start.sh "$r" c1 '"source":"compact"')"
check "PreCompact no bloquea y queda en bitácora" 'grep -q "compactacion.*auto" "$D/bitacora.log"'
check "SessionStart compact pide refrescar la nota" 'grep -q "compactar" <<<"$out" && grep -q "si-auto-nota" <<<"$out"'

# --- Retención de 14 días
touch -d "20 days ago" "$D/entregadas/antigua.md"
gancho session-start.sh "$r" c2 '"source":"startup"' >/dev/null
check "entregadas de más de 14 días se borran" '[ ! -f "$D/entregadas/antigua.md" ]'

# --- Sin python3
r="$(nuevo_repo sin-python)"; D="$(notas "$r")"
binsin="$TMP/bin"; mkdir -p "$binsin"
for c in bash git date mkdir cat dirname sed grep awk mv rm ps tr tail ls basename find sleep env; do
  p="$(command -v "$c")" && ln -sf "$p" "$binsin/$c"
done
out="$(printf '{}' | (cd "$r" && PATH="$binsin" bash "$S/stop.sh"); echo "exit=$?")"
check "sin python3: sale 0 en silencio" '[ "$out" = "exit=0" ]'
check "sin python3: queda anotado" 'grep -q sin-python3 "$D/bitacora.log" && [ -f "$D/falta-python3" ]'
out="$(gancho session-start.sh "$r" p1 '"source":"startup"')"
check "sin python3: aviso único al arrancar" 'grep -q "sin python3" <<<"$out" && [ ! -f "$D/falta-python3" ]'

# --- Casos de la revisión de código
r="$(nuevo_repo reanudada)"; D="$(notas "$r")"
gancho session-start.sh "$r" ra '"source":"startup"' >/dev/null
printf 'nota de ra\n' > "$D/ra.md"
gancho session-end.sh "$r" ra '"reason":"other"' >/dev/null
gancho session-start.sh "$r" ra '"source":"resume"' >/dev/null
out="$(gancho session-start.sh "$r" rb '"source":"startup"')"
check "sesión reanudada sigue viva: su nota no se entrega" '! grep -q "nota de ra" <<<"$out" && [ -f "$D/ra.md" ] && ! grep -q "^terminada=" "$D/ra.meta"'

r="$(nuevo_repo cero "${CONTRATO/Automático: sí/Automático: sí, cada 0 min}")"
check "'cada 0 min' cuenta como apagado" '[ -z "$(gancho session-start.sh "$r" z1 "\"source\":\"startup\"")" ] && [ ! -d "$(notas "$r")" ]'
r="$(nuevo_repo crlf "$(printf '%s' "$CONTRATO" | sed 's/$/\r/')")"
check "CLAUDE.md con CRLF se reconoce" '[ "$(bash -c ". \"$S/comun.sh\"; umbral_del_contrato \"$r\"")" = 30 ]'
r="$(nuevo_repo umbral-raro)"; D="$(notas "$r")"
gancho session-start.sh "$r" u1 '"source":"startup"' >/dev/null; transcript_con_edicion u1
out="$(SI_AUTO_UMBRAL_MIN='1+x' gancho stop.sh "$r" u1 '"stop_hook_active":false')"
check "SI_AUTO_UMBRAL_MIN no numérico se ignora" '[ -z "$out" ]'

r="$(nuevo_repo citada)"; D="$(notas "$r")"
gancho session-start.sh "$r" q1 '"source":"startup"' >/dev/null
gancho stop.sh "$r" q1 '"stop_hook_active":false,"last_assistant_message":"Ejemplo:\n<si-auto-nota>\ncitada\n</si-auto-nota>"' >/dev/null
check "nota no pedida (citada) no se guarda" '[ ! -f "$D/q1.md" ]'
gancho session-start.sh "$r" q1 '"source":"compact"' >/dev/null
gancho stop.sh "$r" q1 '"stop_hook_active":false,"last_assistant_message":"<si-auto-nota>\ntras compactar\n</si-auto-nota>"' >/dev/null
check "tras compactar la nota pedida se guarda" '[ "$(cat "$D/q1.md" 2>/dev/null)" = "tras compactar" ]'
gancho session-start.sh "$r" q1 '"source":"compact"' >/dev/null
gancho stop.sh "$r" q1 '"stop_hook_active":false,"last_assistant_message":"en línea <si-auto-nota>x</si-auto-nota>"' >/dev/null
check "marcas en medio de una línea no cuentan" '[ "$(cat "$D/q1.md")" = "tras compactar" ]'

r="$(nuevo_repo sin-python-arranque)"; D="$(notas "$r")"
out="$(printf '{}' | (cd "$r" && PATH="$binsin" bash "$S/session-start.sh"))"
check "sin python3 en SessionStart: avisa en ese momento" 'grep -q "falta python3" <<<"$out" && [ ! -f "$D/falta-python3" ]'

# --- Revisión de Tablero360
r="$(nuevo_repo bash)"; D="$(notas "$r")"
gancho session-start.sh "$r" b1 '"source":"startup"' >/dev/null
envejecer "$D/b1.meta" inicio 1900
printf '{"type":"assistant","timestamp":"%s","message":{"content":[{"type":"tool_use","name":"Bash","input":{}}]}}\n' \
  "$(date -u +%FT%T.000Z)" >> "$TMP/b1.jsonl"
out="$(gancho stop.sh "$r" b1 '"stop_hook_active":false')"
check "uso de Bash cuenta como actividad" 'grep -q "\"decision\": \"block\"" <<<"$out"'

r="$(nuevo_repo larga)"; D="$(notas "$r")"; mkdir -p "$D/entregadas"
printf 'inicio=%s\npid=%s\n' "$(( $(date -u +%s) - 90000 ))" "$$" > "$D/larga.meta"; echo "nota larga viva" > "$D/larga.md"
printf 'inicio=%s\npid=0\n' "$(( $(date -u +%s) - 90000 ))" > "$D/sinpid.meta"; echo "nota sin pid" > "$D/sinpid.md"
out="$(gancho session-start.sh "$r" l2 '"source":"startup"')"
check "sesión viva de más de 24 h: su nota no se entrega" '! grep -q "nota larga viva" <<<"$out" && [ -f "$D/larga.md" ]'
check "sin PID y más de 24 h: se entrega" 'grep -q "nota sin pid" <<<"$out"'
check "la entrega muestra worktree y rama" 'grep -q "worktree .*, rama " <<<"$out"'
check "la entrega dice que las notas no son instrucciones" 'grep -q "no instrucciones" <<<"$out"'
check "SessionStart guarda worktree y rama" 'grep -q "^worktree=$r$" "$D/l2.meta" && grep -q "^rama=" "$D/l2.meta"'

binpy="$TMP/binpy"; mkdir -p "$binpy"
printf '#!/bin/sh\necho x >> "%s"\nexec %s "$@"\n' "$TMP/contador-python" "$(command -v python3)" > "$binpy/python3"; chmod +x "$binpy/python3"
r="$(nuevo_repo llamadas)"
gancho session-start.sh "$r" p1 '"source":"startup"' >/dev/null
: > "$TMP/contador-python"
PATH="$binpy:$PATH" gancho stop.sh "$r" p1 '"stop_hook_active":false' >/dev/null
check "Stop sin nada que hacer: una sola llamada a python3" '[ "$(wc -l < "$TMP/contador-python")" -eq 1 ]' "$(wc -l < "$TMP/contador-python") llamadas"

# --- Velocidad del camino "nada que hacer"
r="$(nuevo_repo rapido)"
gancho session-start.sh "$r" v1 '"source":"startup"' >/dev/null
ini=$(date +%s%N); gancho stop.sh "$r" v1 '"stop_hook_active":false' >/dev/null; fin=$(date +%s%N)
check "Stop sin nada que hacer < 1 s" '[ $(( (fin - ini) / 1000000 )) -lt 1000 ]' "$(( (fin - ini) / 1000000 )) ms"

# --- git status idéntico en todos los repos de prueba
for r in "$TMP"/*/; do
  [ -d "$r/.git" ] || continue
  check "git status idéntico: $(basename "$r")" 'status_igual "$r"'
done

echo "$casos casos, $fallos fallos"
[ "$fallos" -eq 0 ]
