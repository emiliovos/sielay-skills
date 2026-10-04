#!/usr/bin/env bash
# Build one .zip per skill (for Claude Desktop / claude.ai upload) and publish
# a GitHub release with them attached. Runs locally, never in CI: releases are
# immutable once published, so assets go on a draft first.
#   usage: tools/release-zips.sh v1.0.0
#
# Zips are reproducible byte for byte: only git-tracked files, sorted, stored
# (no compression), fixed timestamps and modes taken from the git index. Each
# zip is built twice and both sha256 must match before anything is published.
set -euo pipefail

tag="${1:?usage: tools/release-zips.sh vX.Y.Z}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "tag must look like vX.Y.Z" >&2; exit 1; }
cd "$(git rev-parse --show-toplevel)"
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean" >&2; exit 1; }
git fetch -q origin
head="$(git rev-parse HEAD)"
[ "$head" = "$(git rev-parse origin/main)" ] ||
  { echo "HEAD ($head) is not origin/main; checkout and pull main first" >&2; exit 1; }
bash tools/check-plugin.sh plugins/si

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
mkdir "$out/a" "$out/b"

# build_zip <slug> <dest>: deterministic zip of the tracked files of one skill,
# with the skill folder at the zip root.
build_zip() {
  git ls-files -s -z -- "plugins/si/skills/$1" | python3 -c '
import sys, zipfile
dest = sys.argv[1]
base = "plugins/si/skills/"
entries = []
for rec in sys.stdin.buffer.read().split(b"\0"):
    if not rec:
        continue
    meta, path = rec.split(b"\t", 1)
    mode, path = meta.split(b" ")[0].decode(), path.decode("utf-8")
    if mode not in ("100644", "100755"):
        sys.exit(f"refusing to package {path}: git mode {mode} (symlink or submodule)")
    entries.append((path, 0o755 if mode == "100755" else 0o644))
if not entries:
    sys.exit("no tracked files for this skill")
with zipfile.ZipFile(dest, "w", zipfile.ZIP_STORED) as z:
    for path, perm in sorted(entries):
        info = zipfile.ZipInfo(path[len(base):], (1980, 1, 1, 0, 0, 0))
        info.create_system = 3  # unix, so external_attr carries the mode
        info.external_attr = (0o100000 | perm) << 16
        info.compress_type = zipfile.ZIP_STORED
        with open(path, "rb") as fh:
            z.writestr(info, fh.read())
' "$2"
}

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

slugs="$(git ls-files -- plugins/si/skills | cut -d/ -f4 | sort -u)"
[ -n "$slugs" ] || { echo "no skills to package" >&2; exit 1; }
for slug in $slugs; do
  build_zip "$slug" "$out/a/$slug.zip"
  build_zip "$slug" "$out/b/$slug.zip"
  sum="$(sha256sum "$out/a/$slug.zip" | cut -d' ' -f1)"
  [ "$sum" = "$(sha256sum "$out/b/$slug.zip" | cut -d' ' -f1)" ] ||
    { echo "$slug.zip is not reproducible (sha256 differs between builds)" >&2; exit 1; }
  echo "| \`$slug.zip\` | \`$sum\` |" >> "$notes"
done

echo >> "$notes"
echo "Commit: \`$head\`" >> "$notes"
gh release create "$tag" "$out"/a/*.zip --draft --title "$tag" --notes-file "$notes" --target "$head"
gh release edit "$tag" --draft=false
echo "published $tag ($head) with $(ls "$out"/a/*.zip | wc -l) zip(s)"
