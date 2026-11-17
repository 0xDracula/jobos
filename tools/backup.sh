#!/usr/bin/env bash
set -euo pipefail

dest="${1:-${BACKUP_DIR:?set BACKUP_DIR or pass a backup directory}}"
media="${MEDIA_ROOT:?set MEDIA_ROOT}"
db_url="${DATABASE_URL:?set DATABASE_URL}"
day="$(date +%F)"
out="$dest/daily/$day"
tmp="$dest/.partial-$day"

rm -rf "$tmp"
mkdir -p "$tmp"

if command -v pg_dump >/dev/null 2>&1; then
  pg_dump --format=custom --file="$tmp/db.dump" "$db_url"
else
  rest="${db_url#*://}"
  user="${rest%%[:@]*}"
  db="${rest#*/}"
  db="${db%%\?*}"
  docker exec "${DB_CONTAINER:-deploy-db-1}" pg_dump --format=custom -U "$user" -d "$db" >"$tmp/db.dump"
fi

tar --create --gzip --file="$tmp/media.tar.gz" --directory="$media" \
  --exclude=./audio --exclude=./artwork --exclude=./stems .

(cd "$tmp" && sha256sum db.dump media.tar.gz >SHA256SUMS)

rm -rf "$out"
mkdir -p "$dest/daily"
mv "$tmp" "$out"

keep() {
  mkdir -p "$dest/$1"
  rm -rf "$dest/$1/$day"
  cp -al "$out" "$dest/$1/$day"
}
[ "$(date +%u)" = 7 ] && keep weekly
[ "$(date +%d)" = 01 ] && keep monthly

prune() {
  [ -d "$dest/$1" ] || return 0
  ls -1d "$dest/$1"/*/ 2>/dev/null | sort | head -n -"$2" | xargs -r rm -rf
}
prune daily 7
prune weekly 4
prune monthly 6

echo "backup $out: db $(du -h "$out/db.dump" | cut -f1), media $(du -h "$out/media.tar.gz" | cut -f1)"
