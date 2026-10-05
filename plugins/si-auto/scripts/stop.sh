#!/usr/bin/env bash
# Stop: guarda la nota y los veredictos que Claude dejó en su último mensaje y,
# si ya toca, bloquea una vez el fin del turno para pedirle la nota.
. "$(dirname "$0")/comun.sh"
iniciar_gancho Stop

META="$D/$SESION.meta"
[ -n "$(leer_meta "$META" inicio)" ] || poner_meta "$META" inicio "$(ahora)"

# 1. Nota entre marcas, solo si si-auto la pidió (bloqueo o compactación):
#    así no se guarda una nota que Claude solo esté citando.
nota=""
if [ "$(leer_meta "$META" pide_nota)" = 1 ]; then
  nota="$(printf '%s' "$ENTRADA" | py nota)"
fi
if [ -n "$nota" ]; then
  borrar_meta "$META" pide_nota
  printf '%s\n' "$nota" > "$D/$SESION.md.tmp" && mv "$D/$SESION.md.tmp" "$D/$SESION.md"
  poner_meta "$META" ultima_nota "$(ahora)"
  bitacora nota-guardada
fi

# 2. Veredictos sobre notas que esta misma sesión recibió al arrancar.
while IFS=$'\t' read -r id valor; do
  [ -n "$id" ] || continue
  m="$D/entregadas/$id.meta"
  if [ "$(leer_meta "$m" entregada_a)" = "$SESION" ]; then
    poner_meta "$m" veredicto "$valor"
    bitacora veredicto "$id $valor"
  fi
done <<<"$(printf '%s' "$ENTRADA" | py veredictos)"

# 3. Nunca bloquear dos veces seguidas.
if [ "$(campo stop_hook_active)" = true ]; then
  [ -n "$nota" ] || bitacora bloqueo-sin-nota
  exit 0
fi

# 4. Umbral: pasaron N min desde el inicio, la última nota o el último bloqueo...
inicio="$(leer_meta "$META" inicio)"
ultima="$(leer_meta "$META" ultima_nota)"; ultima="${ultima:-0}"
bloqueo="$(leer_meta "$META" ultimo_bloqueo)"; bloqueo="${bloqueo:-0}"
base=$(( inicio > ultima ? inicio : ultima ))
ref=$(( base > bloqueo ? base : bloqueo ))
t="$(ahora)"
[ $(( t - ref )) -ge $(( UMBRAL_MIN * 60 )) ] || exit 0

# ...y esta sesión editó al menos un archivo desde su última nota.
editadas="$(py ediciones "$(campo transcript_path)" "$base")"
[ "${editadas:-0}" -ge 1 ] || exit 0

poner_meta "$META" ultimo_bloqueo "$(ahora)"
poner_meta "$META" pide_nota 1
bitacora bloqueo
py bloqueo <<'ORDEN'
si-auto: escribe ahora tu nota de sesión entre <si-auto-nota> y </si-auto-nota>, con: qué se hizo, decisiones, qué se validó, qué quedó a medias, archivos tocados sin commit, siguiente paso y un prompt de continuación. Sin valores sensibles (claves, tokens, contraseñas). Máximo 15 líneas. No uses herramientas para esto. Después, si tu respuesta anterior terminaba con una pregunta al usuario, repítela textual al final.
ORDEN
