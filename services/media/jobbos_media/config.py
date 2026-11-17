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
MAX_GAIN_DB = 30.0
LOUDNESS_TOLERANCE = 0.5
SAMPLE_RATE = 44_100
AAC_BITRATE = 192_000
AAC_OPTIONS = ("-aac_pns", "0", "-aac_is", "0")
ENCODES = (
    (-2.0, "fast", AAC_BITRATE),
    (-3.0, "fast", AAC_BITRATE),
    (-2.0, "twoloop", 256_000),
    (-3.0, "twoloop", 256_000),
    (-4.0, "fast", AAC_BITRATE),
    (-5.0, "fast", AAC_BITRATE),
)
WAVEFORM_POINTS = 256
