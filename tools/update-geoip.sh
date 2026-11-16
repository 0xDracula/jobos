#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
dest="${GEOIP_DB:-$PWD/.data/geo/dbip-city-lite.mmdb}"
mkdir -p "$(dirname "$dest")"
month="$(date -u +%Y-%m)"
url="https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz"
tmp="$(mktemp "${dest}.XXXXXX")"
trap 'rm -f "$tmp" "$tmp.gz"' EXIT
if ! curl -fsSL --retry 3 -o "$tmp.gz" "$url"; then
  month="$(date -u -d "$(date -u +%Y-%m-15) -1 month" +%Y-%m)"
  curl -fsSL --retry 3 -o "$tmp.gz" "https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz"
fi
gunzip -c "$tmp.gz" > "$tmp"
mv "$tmp" "$dest"
echo "GeoIP database ${month}: $dest ($(du -h "$dest" | cut -f1))"
