#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
host="${DEPLOY_HOST:-nest}"
dest="${DEPLOY_DIR:-/srv/jobbos}"
out=.data/deploy
mkdir -p "$out"

(cd services/api && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o "../../$out/api" ./cmd/api)
if [ "${SKIP_WEB:-}" != "1" ]; then
  (cd apps/web && npm run build)
fi

push() { for n in 1 2 3; do rsync -az "$@" && return; sleep 3; done; return 1; }
sync() { push --delete "$@"; }
sync "$out/api" "$host:$dest/bin/api.new"
sync apps/web/out/ "$host:$dest/web/"
sync db/migrations/ "$host:$dest/db/migrations/"
sync tools/backup.sh tools/restore.sh "$host:$dest/tools/"
sync --exclude .venv --exclude tests --exclude __pycache__ --exclude .pytest_cache services/media/ "$host:$dest/services/media/"
push deploy/systemd/ "$host:/etc/systemd/system/"

ssh "$host" bash -s -- "$dest" <<'REMOTE'
set -euo pipefail
dest="$1"
cd "$dest/services/media"
uv sync --frozen --no-dev --python 3.12 -q
mv "$dest/bin/api.new" "$dest/bin/api"
systemctl daemon-reload
units="jobbos-api jobbos-media jobbos-worker jobbos-worker-heavy"
systemctl enable -q $units
systemctl restart $units
sleep 3
systemctl --no-pager --lines=0 status $units | grep -E '^● |Active:'
REMOTE
