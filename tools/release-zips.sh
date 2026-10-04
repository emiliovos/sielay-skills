#!/usr/bin/env bash
# Build one .zip per skill (for Claude Desktop / claude.ai upload) and publish
# a GitHub release with them attached. Runs locally, never in CI: releases are
# immutable once published, so assets go on a draft first.
#   usage: tools/release-zips.sh v1.0.0
set -euo pipefail

tag="${1:?usage: tools/release-zips.sh vX.Y.Z}"
cd "$(git rev-parse --show-toplevel)"
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean" >&2; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "run from main" >&2; exit 1; }
bash tools/check-plugin.sh plugins/si

out="$(mktemp -d)"
notes="$out/notes.md"
{
  echo "Skills de \`si\` para Claude Code y Claude Desktop."
  echo
  echo "Claude Code: \`claude plugin marketplace add emiliovos/sielay-skills && claude plugin install si@sielay\`"
  echo
  echo "Claude Desktop: sube el .zip de la skill en la configuración de skills de tu cuenta."
  echo
  echo "| Archivo | sha256 |"
  echo "|---|---|"
} > "$notes"

for d in plugins/si/skills/*/; do
  slug="$(basename "$d")"
  # Deterministic zip (sorted entries, fixed timestamps), skill folder at the root.
  python3 - "$slug" "$out/$slug.zip" <<'PY'
import os, sys, zipfile
slug, dest = sys.argv[1], sys.argv[2]
base = os.path.join("plugins", "si", "skills")
files = sorted(os.path.join(r, f) for r, _, fs in os.walk(os.path.join(base, slug)) for f in fs)
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
    for path in files:
        info = zipfile.ZipInfo(os.path.relpath(path, base), (2026, 1, 1, 0, 0, 0))
        info.external_attr = (0o755 if os.access(path, os.X_OK) else 0o644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(path, "rb") as fh:
            z.writestr(info, fh.read())
PY
  sum="$(sha256sum "$out/$slug.zip" | cut -d' ' -f1)"
  echo "| \`$slug.zip\` | \`$sum\` |" >> "$notes"
done

echo "Commit: \`$(git rev-parse HEAD)\`" >> "$notes"
gh release create "$tag" "$out"/*.zip --draft --title "$tag" --notes-file "$notes" --target main
gh release edit "$tag" --draft=false
echo "published $tag with $(ls "$out"/*.zip | wc -l) zip(s)"
