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
  # Deterministic zip: fixed timestamps and sorted entries, folder at the root.
  (cd plugins/si/skills && find "$slug" -type f | sort | TZ=UTC xargs touch -d '2026-01-01T00:00:00' && find "$slug" -type f | sort | zip -X -q "$out/$slug.zip" -@)
  sum="$(sha256sum "$out/$slug.zip" | cut -d' ' -f1)"
  echo "| \`$slug.zip\` | \`$sum\` |" >> "$notes"
done

echo "Commit: \`$(git rev-parse HEAD)\`" >> "$notes"
gh release create "$tag" "$out"/*.zip --draft --title "$tag" --notes-file "$notes" --target main
gh release edit "$tag" --draft=false
echo "published $tag with $(ls "$out"/*.zip | wc -l) zip(s)"
