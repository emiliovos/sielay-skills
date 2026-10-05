#!/usr/bin/env bash
# SessionEnd: solo marca la sesión como terminada. Sin modelo ni procesos lanzados.
. "$(dirname "$0")/comun.sh"
iniciar_gancho SessionEnd
META="$D/$SESION.meta"
[ -f "$META" ] || exit 0
poner_meta "$META" terminada "$(ahora) $(campo reason)"
bitacora terminada "$(campo reason)"
