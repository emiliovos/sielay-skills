#!/usr/bin/env bash
# Muestra las notas de si-auto del repo actual y la cola de la bitácora. Solo lectura.
#   uso: bash ver-notas.sh [directorio-del-repo]
set -u
dir="${1:-$PWD}"
comun="$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ||
  { echo "No es un repo de git: $dir"; exit 1; }
D="$comun/si-auto"
[ -d "$D" ] || { echo "si-auto no ha guardado nada en este repo."; exit 0; }
echo "== Notas pendientes"
for n in "$D"/*.md; do [ -f "$n" ] && echo "$(basename "$n" .md)  $(sed -n 's/^terminada=//p' "${n%.md}.meta" 2>/dev/null)"; done
echo "== Notas entregadas (últimos 14 días)"
for n in "$D"/entregadas/*.md; do
  [ -f "$n" ] || continue
  m="${n%.md}.meta"
  echo "$(basename "$n" .md)  a=$(sed -n 's/^entregada_a=//p' "$m")  veredicto=$(sed -n 's/^veredicto=//p' "$m")"
done
echo "== Bitácora (últimas 20 líneas)"
tail -n 20 "$D/bitacora.log" 2>/dev/null
