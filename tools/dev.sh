#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
trap 'trap - EXIT; kill 0' EXIT INT TERM

make --no-print-directory api 2>&1 | sed -u 's/^/[api]    /' &
make --no-print-directory media 2>&1 | sed -u 's/^/[media]  /' &
make --no-print-directory worker 2>&1 | sed -u 's/^/[worker] /' &

echo "[dev]    test page: http://${LISTEN_ADDR:-127.0.0.1:8080}/dev/"
wait
