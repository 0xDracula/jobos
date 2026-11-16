#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../services/media"
uv lock --upgrade-package yt-dlp
uv sync
uv run python -c "from yt_dlp import version; print('yt-dlp', version.__version__)"
