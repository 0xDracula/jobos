#!/usr/bin/env bash
set -euo pipefail

src="${1:?backup directory}"
name="${2:?name of the new database}"
media="${3:?directory for the media}"
db_url="${DATABASE_URL:?set DATABASE_URL}"

(cd "$src" && sha256sum --check --quiet SHA256SUMS)

rest="${db_url#*://}"
user="${rest%%[:@]*}"
if command -v pg_restore >/dev/null 2>&1; then
  base="${db_url%/*}"
  createdb --maintenance-db="$db_url" "$name"
  pg_restore --no-owner --dbname="$base/$name" "$src/db.dump"
else
  container="${DB_CONTAINER:-deploy-db-1}"
  docker exec "$container" createdb -U "$user" "$name"
  docker exec -i "$container" pg_restore --no-owner -U "$user" -d "$name" <"$src/db.dump"
fi

mkdir -p "$media"
tar --extract --gzip --file="$src/media.tar.gz" --directory="$media"
echo "restored $src into database $name and $media"
