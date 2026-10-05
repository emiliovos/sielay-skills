#!/usr/bin/env bash
# SessionStart: registra esta sesión y entrega a Claude las notas de sesiones
# anteriores que terminaron (o murieron) sin que nadie las haya recibido.
. "$(dirname "$0")/comun.sh"
iniciar_gancho SessionStart

META="$D/$SESION.meta"
aviso=""
if [ -f "$D/falta-python3" ]; then
  rm -f "$D/falta-python3"
  aviso="si-auto: algún gancho corrió sin python3 y no pudo guardar notas. Avísale al usuario en una línea."$'\n'
fi

# PID del proceso de Claude: el primer ancestro cuyo comando es "claude".
pid=0; p=$PPID
for _ in 1 2 3 4 5 6; do
  [ -n "$p" ] && [ "$p" -gt 1 ] || break
  if [ "$(ps -o comm= -p "$p" 2>/dev/null)" = claude ]; then pid=$p; break; fi
  p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
done
[ -n "$(leer_meta "$META" inicio)" ] || poner_meta "$META" inicio "$(ahora)"
poner_meta "$META" pid "$pid"

# Las notas ya entregadas se conservan 14 días para la revisión del piloto.
find "$D/entregadas" -type f -mtime +14 -delete 2>/dev/null

if [ "$(campo source)" = compact ]; then
  printf '%ssi-auto: se acaba de compactar la conversación. En tu próxima respuesta escribe tu nota de sesión actualizada entre <si-auto-nota> y </si-auto-nota> (qué se hizo, decisiones, qué quedó a medias, siguiente paso; sin valores sensibles; máximo 15 líneas; sin herramientas).\n' "$aviso" | py contexto SessionStart
  exit 0
fi

# Notas de otras sesiones: se entregan si la sesión terminó, si su proceso ya no vive,
# o si lleva más de un día sin marca de terminada y sin PID conocido.
entregar=""
while IFS= read -r m; do
  [ -n "$m" ] || continue
  id="$(basename "$m" .meta)"
  [ "$id" != "$SESION" ] || continue
  termino="$(leer_meta "$m" terminada)"
  otro="$(leer_meta "$m" pid)"; otro="${otro:-0}"
  inicio="$(leer_meta "$m" inicio)"; inicio="${inicio:-0}"
  if [ -z "$termino" ]; then
    if [ "$otro" -gt 0 ]; then
      ! kill -0 "$otro" 2>/dev/null || continue
    else
      [ $(( $(ahora) - inicio )) -ge 86400 ] || continue
    fi
  fi
  if [ ! -f "$D/$id.md" ]; then
    rm -f "$m"   # sesión terminada que nunca escribió nota: nada que entregar
    continue
  fi
  # Reclamo atómico: si otro arranque movió la nota primero, este no la entrega.
  mv "$D/$id.md" "$D/entregadas/$id.md" 2>/dev/null || continue
  mv "$m" "$D/entregadas/$id.meta"
  poner_meta "$D/entregadas/$id.meta" entregada_a "$SESION"
  poner_meta "$D/entregadas/$id.meta" entregada_en "$(ahora)"
  bitacora entregada "$id"
  entregar+=$'\n'"--- nota $id ---"$'\n'"$(cat "$D/entregadas/$id.md")"$'\n'
done < <(ls -tr "$D"/*.meta 2>/dev/null)

if [ -n "$entregar" ]; then
  {
    printf '%s' "$aviso"
    printf 'si-auto: notas de sesiones anteriores en este repo que se cerraron sin entregarse.\n'
    printf 'Revisa si el archivo de estado del contrato "## Cierre de sesión" ya refleja cada nota; si falta algo, intégralo siguiendo el CLAUDE.md. El commit va en el cierre normal de esta sesión: nada de commit ni push ahora.\n'
    printf 'En tu primera respuesta escribe, por cada nota, <si-auto-veredicto nota="ID">ya-reflejada|integrada|parcial</si-auto-veredicto>.\n'
    printf '%s' "$entregar"
  } | py contexto SessionStart
elif [ -n "$aviso" ]; then
  printf '%s' "$aviso" | py contexto SessionStart
fi
