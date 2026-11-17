#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
dir="${MAP_DIR:-$PWD/.data/map}"
bbox="${MAP_BBOX:-30.88,29.82,31.56,30.20}"
maxzoom="${MAP_MAXZOOM:-15}"
build="${PMTILES_BUILD:-}"
version="${PMTILES_VERSION:-v1.31.2}"
fonts="https://protomaps.github.io/basemaps-assets/fonts"

mkdir -p "$dir"
if [ -z "$build" ]; then
  build="$(curl -fsSL --retry 3 https://build-metadata.protomaps.dev/builds.json |
    grep -o '"key":"[0-9]\{8\}\.pmtiles"' | tail -n 1 | grep -o '[0-9]\{8\}')"
fi
tmp="$dir/cairo.pmtiles.part"
trap 'rm -f "$tmp"' EXIT
go run "github.com/protomaps/go-pmtiles@${version}" extract "https://build.protomaps.com/${build}.pmtiles" "$tmp" \
  --bbox="$bbox" --maxzoom="$maxzoom"
mv "$tmp" "$dir/cairo.pmtiles"

for stack in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
  mkdir -p "$dir/fonts/$stack"
  for range in 0-255 256-511 8192-8447; do
    curl -fsSL --retry 3 -o "$dir/fonts/$stack/$range.pbf" "$fonts/${stack// /%20}/$range.pbf"
  done
done
printf '{"build":"%s","bbox":"%s","maxzoom":%s}\n' "$build" "$bbox" "$maxzoom" > "$dir/cairo.json"
echo "Map ${build}: $dir/cairo.pmtiles ($(du -h "$dir/cairo.pmtiles" | cut -f1))"
