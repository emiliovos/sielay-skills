#!/usr/bin/env bash
# Type-checks the sielay-link mod (JS + JSDoc, checkJs) against the plugin API
# declarations of the Claude Code build in use. Local only: the declarations
# ship with Claude Code, not with this repo.
#   usage: CLAUDE_CODE_TYPES=<path to claude-code.d.ts> TSC=<tsc binary> bash tests/sielay-link/run-typecheck.sh
# The declarations are the plugin-authoring skill's types/claude-code.d.ts, or the
# .claude-plugin/types/claude-code/index.d.ts the engine lays beside a mod it loads
# from a --plugin-dir folder.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TYPES="${CLAUDE_CODE_TYPES:?set CLAUDE_CODE_TYPES to the path of claude-code.d.ts}"
TSC="${TSC:-tsc}"
[ -f "$TYPES" ] || { echo "ERROR: $TYPES not found" >&2; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/types/claude-code"
cp "$TYPES" "$TMP/types/claude-code/index.d.ts"
cat > "$TMP/tsconfig.json" <<JSON
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "noEmit": true, "skipLibCheck": true,
    "allowJs": true, "checkJs": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment",
    "typeRoots": ["$TMP/types"], "types": ["claude-code"]
  },
  "include": ["$ROOT/plugins/sielay-link/mod", "$ROOT/plugins/sielay-link/types", "$ROOT/plugins/sielay-link/tests"]
}
JSON
"$TSC" -p "$TMP/tsconfig.json"
echo "typecheck: OK"
