#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
trap 'trap - EXIT; kill 0' EXIT INT TERM

make --no-print-directory api 2>&1 | sed -u 's/^/[api]    /' &
make --no-print-directory media 2>&1 | sed -u 's/^/[media]  /' &
make --no-print-directory worker 2>&1 | sed -u 's/^/[worker] /' &
if [ "${WEB_DEV:-}" = "1" ]; then
  make --no-print-directory web 2>&1 | sed -u 's/^/[web]    /' &
  echo "[dev]    web app (dev server): http://127.0.0.1:3000/"
fi

echo "[dev]    web app (static export, after make web-build): http://${LISTEN_ADDR:-127.0.0.1:8080}/"
echo "[dev]    test page: http://${LISTEN_ADDR:-127.0.0.1:8080}/dev/"
wait
