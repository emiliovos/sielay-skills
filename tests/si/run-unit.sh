#!/usr/bin/env bash
# Pruebas unitarias de la skill checkpoint con node --test. Sin Claude, sin red
# y sin tocar procesos reales: las fuentes (/proc, ps, fs, kill) se inyectan.
#   usage: bash tests/si/run-unit.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 18 ] || { echo "ERROR: Node 18+ is required (found $(node --version))" >&2; exit 1; }
node --test tests/si/*.test.mjs
