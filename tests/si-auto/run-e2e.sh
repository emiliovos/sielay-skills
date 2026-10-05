#!/usr/bin/env bash
# Pruebas de punta a punta de si-auto con Claude Code real (claude -p) y un modelo barato.
# No corre en CI: necesita una sesión de Claude. Se corre antes del PR y la salida va al PR.
# Carga los plugins desde este repo (--plugin-dir) e ignora la configuración del usuario.
# El trabajo de Claude va a archivos ignorados por git, así que git status debe quedar limpio.
#   uso: bash tests/si-auto/run-e2e.sh
set -u
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fallos=0; casos=0
check() { casos=$((casos+1)); if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fallos=$((fallos+1)); fi; }

CONTRATO=$'# Repo de prueba\n\n## Cierre de sesión\n- Estado: docs/estado.md\n- Push: no pushear\n- Handoff: pantalla\n- Automático: sí\n'
nuevo_repo() { # nombre [CLAUDE.md]
  local r="$TMP/$1"; mkdir -p "$r" && git -C "$r" init -q
  printf '%s' "${2-$CONTRATO}" > "$r/CLAUDE.md"; echo "trabajo/" > "$r/.gitignore"
  git -C "$r" add -A && git -C "$r" -c user.email=t@t -c user.name=t commit -qm i
  echo "$r"
}
notas() { echo "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)/si-auto"; }
claude_en() { # repo prompt [flags...]  → salida JSON de claude -p
  local r="$1" p="$2"; shift 2
  (cd "$r" && SI_AUTO_UMBRAL_MIN=0 timeout 300 claude -p "$p" --model haiku --output-format json \
     --setting-sources project --plugin-dir "$RAIZ/plugins/si" --plugin-dir "$RAIZ/plugins/si-auto" \
     --permission-mode acceptEdits "$@" < /dev/null 2>/dev/null)
}
resultado() { python3 -c 'import json,sys; print(json.load(sys.stdin).get("result",""))'; }
sesion() { python3 -c 'import json,sys; print(json.load(sys.stdin).get("session_id",""))'; }
limpio() { [ -z "$(git -C "$1" status --porcelain)" ]; }

echo "Claude Code $(claude --version)"

# 1. Cierre normal: edita, Stop bloquea, Claude escribe la nota y el gancho la guarda.
r="$(nuevo_repo normal)"; D="$(notas "$r")"
j="$(claude_en "$r" "Crea el archivo trabajo/a.txt con el texto hola. Luego dime listo.")"
s1="$(sesion <<<"$j")"
check "cierre normal: nota guardada" '[ -s "$D/$s1.md" ]'
check "cierre normal: bloqueo en bitácora" 'grep -q "bloqueo" "$D/bitacora.log"'
check "cierre normal: SessionEnd marcó terminada" 'grep -q "^terminada=" "$D/$s1.meta"'
check "cierre normal: git status limpio" 'limpio "$r"'

# 2. La sesión siguiente recibe la nota y da su veredicto.
j="$(claude_en "$r" "Hola. Responde en una línea.")"
s2="$(sesion <<<"$j")"
check "entrega: nota movida a entregadas para la sesión nueva" 'grep -q "^entregada_a=$s2" "$D/entregadas/$s1.meta"'
check "entrega: veredicto registrado" 'grep -qE "^veredicto=(ya-reflejada|integrada|parcial)" "$D/entregadas/$s1.meta"'
check "entrega: git status limpio" 'limpio "$r"'

# 3. Turno que termina en pregunta: la pregunta se repite después de la nota.
r="$(nuevo_repo pregunta)"; D="$(notas "$r")"
j="$(claude_en "$r" "Crea trabajo/b.txt con el texto uno. Termina tu respuesta preguntándome exactamente: ¿Creo otro archivo?")"
check "pregunta: la respuesta final termina con la pregunta" 'resultado <<<"$j" | tail -1 | grep -q "Creo otro archivo"'
check "pregunta: nota guardada" '[ -s "$D/$(sesion <<<"$j").md" ]'

# 4. Compactación manual: PreCompact no bloquea y queda en la bitácora.
s="$(sesion <<<"$j")"
claude_en "$r" "/compact" --resume "$s" >/dev/null
check "compactación: registrada y sin bloqueo" 'grep -q "compactacion.*manual" "$D/bitacora.log"'
check "compactación: git status limpio" 'limpio "$r"'

# 5. Tres sesiones a la vez en la misma carpeta: cada una guarda su propia nota.
r="$(nuevo_repo tres)"; D="$(notas "$r")"
for i in 1 2 3; do claude_en "$r" "Crea trabajo/s$i.txt con el texto $i. Luego dime listo." > "$TMP/j$i" & done; wait
n=0; for i in 1 2 3; do [ -s "$D/$(sesion < "$TMP/j$i").md" ] && n=$((n+1)); done
check "tres sesiones: tres notas" '[ "$n" = 3 ]'
check "tres sesiones: git status limpio" 'limpio "$r"'

# 6. Repo sin la sección del contrato: si-auto no hace nada.
r="$(nuevo_repo sin-contrato "# Repo sin contrato")"
claude_en "$r" "Crea trabajo/c.txt con el texto x. Luego dime listo." >/dev/null
check "sin contrato: no crea nada" '[ ! -d "$(notas "$r")" ] && limpio "$r"'

echo "$casos casos, $fallos fallos"
[ "$fallos" -eq 0 ]
