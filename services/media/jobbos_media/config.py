import os
from pathlib import Path

API_URL = os.environ.get("API_URL", "http://127.0.0.1:8080")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", ".data/media")).resolve()
YTDLP_COOKIES = os.environ.get("YTDLP_COOKIES") or None
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE", "ffprobe")

TARGET_LUFS = -14.0
TARGET_TRUE_PEAK = -1.0
AAC_BITRATE = 192_000
WAVEFORM_POINTS = 256
