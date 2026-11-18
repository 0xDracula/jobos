#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
dir="${MODELS_DIR:-$PWD/.data/models}"
base="https://essentia.upf.edu/models"
models=(
  feature-extractors/discogs-effnet/discogs-effnet-bsdynamic-1
  feature-extractors/musicnn/msd-musicnn-1
  classification-heads/mood_happy/mood_happy-discogs-effnet-1
  classification-heads/mood_sad/mood_sad-discogs-effnet-1
  classification-heads/mood_relaxed/mood_relaxed-discogs-effnet-1
  classification-heads/mood_aggressive/mood_aggressive-discogs-effnet-1
  classification-heads/voice_instrumental/voice_instrumental-discogs-effnet-1
  classification-heads/deam/deam-msd-musicnn-2
)

mkdir -p "$dir"
for m in "${models[@]}"; do
  name="$(basename "$m")"
  for ext in json onnx; do
    [ -s "$dir/$name.$ext" ] && continue
    curl -fsSL --retry 3 -o "$dir/$name.$ext.part" "$base/$m.$ext"
    mv "$dir/$name.$ext.part" "$dir/$name.$ext"
  done
done
echo "models in $dir: $(du -sh "$dir" | cut -f1)"
