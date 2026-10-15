#!/usr/bin/env bash
# Unit and client E2E tests of sielay-link with node --test. No Claude, no
# network beyond 127.0.0.1 (a fake hub over node:http) and a temp unix socket.
#   usage: bash tests/sielay-link/run-unit.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 22 ] || { echo "ERROR: Node 22+ is required (found $(node --version))" >&2; exit 1; }
node --test tests/sielay-link/*.test.mjs
