#!/usr/bin/env bash
# Funciones compartidas por los ganchos de si-auto.
# Del repo solo se lee: `git rev-parse` y el CLAUDE.md de la raíz.
# Solo se escribe dentro de $D = <git-common-dir>/si-auto, que git no muestra en status.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRADA=""
SESION=""
D=""
UMBRAL_MIN=30
RAIZ=""

ahora() { date -u +%s; }
py() { python3 "$AQUI/leer-json.py" "$@"; }
# Los campos del JSON del gancho se leen con una sola llamada a python (iniciar_gancho)
# y campo() los busca por nombre, en el mismo orden que CAMPOS en leer-json.py.
CAMPOS=()
campo() {
  local i n
  i=0
  for n in session_id cwd transcript_path stop_hook_active source reason trigger; do
    if [ "$n" = "$1" ]; then printf '%s' "${CAMPOS[$i]:-}"; return 0; fi
    i=$((i + 1))
  done
}

# Una línea por evento; nunca contenido de notas.
bitacora() { printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$1" "${SESION:-?}" "${2:-}" >> "$D/bitacora.log"; }

# Archivos .meta: líneas clave=valor. Se reescriben con tmp + mv para no dejarlos a medias.
leer_meta() { [ -f "$1" ] && sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1; }
# Solo dígitos (o 0): un .meta alterado no puede inyectar código en $(( )).
leer_num() { local v; v="$(leer_meta "$1" "$2")"; [[ "$v" =~ ^[0-9]+$ ]] && echo "$v" || echo 0; }
poner_meta() {
  { [ -f "$1" ] && grep -v "^$2=" "$1"; printf '%s=%s\n' "$2" "$3"; } > "$1.tmp.$$" && mv "$1.tmp.$$" "$1"
}
borrar_meta() {
  [ -f "$1" ] || return 0
  { grep -v "^$2=" "$1" || true; } > "$1.tmp.$$" && mv "$1.tmp.$$" "$1"
}

# Imprime el umbral en minutos si el CLAUDE.md de la raíz enciende si-auto; si no, nada.
# Exige la sección exacta "## Cierre de sesión" y, dentro, "- Automático: sí" o "- Automático: sí, cada N min".
umbral_del_contrato() {
  [ -f "$1/CLAUDE.md" ] || return 0
  awk '
    { sub(/\r$/, "") }
    /^## / { dentro = ($0 == "## Cierre de sesión") ; next }
    dentro && /^- Automático: sí[[:space:]]*$/ { print 30; exit }
    dentro && match($0, /^- Automático: sí, cada [0-9]+ min[[:space:]]*$/) {
      n = $0; gsub(/[^0-9]/, "", n); print n; exit
    }
  ' "$1/CLAUDE.md"
}

# Resuelve repo, contrato y carpeta de notas a partir de un directorio. Sale en silencio si no aplica.
preparar_repo() {
  local comun umbral
  RAIZ="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null)" || exit 0
  umbral="$(umbral_del_contrato "$RAIZ")"
  [ -n "$umbral" ] || exit 0
  # El contrato exige N >= 1; SI_AUTO_UMBRAL_MIN (solo pruebas) admite 0.
  [[ "$umbral" =~ ^[0-9]+$ ]] && [ "$umbral" -ge 1 ] || exit 0
  UMBRAL_MIN="$umbral"
  if [[ "${SI_AUTO_UMBRAL_MIN:-}" =~ ^[0-9]+$ ]]; then UMBRAL_MIN="$SI_AUTO_UMBRAL_MIN"; fi
  comun="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0
  D="$comun/si-auto"
  mkdir -p "$D/entregadas"
}

# Entrada común de los ganchos: lee el JSON de stdin y deja listas $SESION y $D.
iniciar_gancho() {
  [ "${SI_AUTO_OFF:-}" = 1 ] && exit 0
  ENTRADA="$(cat)"
  if ! command -v python3 >/dev/null 2>&1; then
    # Sin python3 no se puede leer el JSON: se anota y session-start avisa una vez.
    preparar_repo "$PWD"
    bitacora sin-python3 "$1"
    if [ "$1" = SessionStart ]; then
      # El texto plano de SessionStart llega a Claude como contexto.
      echo "si-auto: falta python3, así que las notas automáticas no funcionan en este repo. Avísale al usuario en una línea."
      rm -f "$D/falta-python3"
    else
      : > "$D/falta-python3"
    fi
    exit 0
  fi
  mapfile -t CAMPOS < <(printf '%s' "$ENTRADA" | py campos)
  preparar_repo "$(campo cwd)"
  SESION="$(campo session_id)"
  [[ "$SESION" =~ ^[A-Za-z0-9-]+$ ]] || exit 0
}
