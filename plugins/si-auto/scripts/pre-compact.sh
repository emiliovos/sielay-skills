#!/usr/bin/env bash
# PreCompact: nunca bloquea. Solo deja constancia; SessionStart (source=compact)
# pide refrescar la nota después de compactar.
. "$(dirname "$0")/comun.sh"
iniciar_gancho PreCompact
bitacora compactacion "$(campo trigger)"
