from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from array import array
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yt_dlp

from . import config

_LOUDNORM = f"loudnorm=I={config.TARGET_LUFS}:TP={config.TARGET_TRUE_PEAK}:LRA=11"


def source_url(provider: str, external_id: str) -> str:
    if external_id.startswith(("http://", "https://")):
        return external_id
    if provider in ("ytmusic", "youtube"):
        return f"https://www.youtube.com/watch?v={external_id}"
    raise ValueError(f"no URL for provider {provider!r} and id {external_id!r}")


def download(url: str, workdir: Path) -> tuple[Path, dict]:
    opts = {
        "format": "bestaudio[ext=m4a]/bestaudio/best",
        "outtmpl": str(workdir / "source.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
    }
    if config.YTDLP_COOKIES:
        opts["cookiefile"] = config.YTDLP_COOKIES
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = Path(ydl.prepare_filename(info))
    meta = {
        "title": info.get("title"),
        "uploader": info.get("uploader") or info.get("channel"),
        "duration_ms": int(info["duration"] * 1000) if info.get("duration") else None,
        "highlight": highlight(info.get("heatmap")),
    }
    return path, meta


STREAM_MIMES = {"m4a": "audio/mp4", "mp4": "audio/mp4", "webm": "audio/webm", "mp3": "audio/mpeg", "ogg": "audio/ogg"}


def resolve(provider: str, external_id: str) -> dict:
    opts = {"format": "bestaudio[ext=m4a]/bestaudio", "quiet": True, "no_warnings": True, "noplaylist": True}
    if config.YTDLP_COOKIES:
        opts["cookiefile"] = config.YTDLP_COOKIES
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(source_url(provider, external_id), download=False)
    return stream_info(info)


def stream_info(info: dict) -> dict:
    url = info["url"]
    expire = parse_qs(urlparse(url).query).get("expire", [None])[0]
    return {
        "url": url,
        "headers": info.get("http_headers") or {},
        "mime": STREAM_MIMES.get(info.get("ext") or "", "application/octet-stream"),
        "bytes": info.get("filesize") or info.get("filesize_approx"),
        "duration_ms": int(info["duration"] * 1000) if info.get("duration") else None,
        "expires_at": int(expire) if expire and expire.isdigit() else None,
    }


def highlight(heatmap: list[dict] | None) -> dict | None:
    if not heatmap:
        return None
    top = max(heatmap, key=lambda h: h.get("value", 0))
    return {"start_ms": int(top["start_time"] * 1000), "end_ms": int(top["end_time"] * 1000)}


def _ffmpeg(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([config.FFMPEG, "-hide_banner", "-nostats", *args], capture_output=True, check=True)


def measure_loudness(path: Path) -> dict:
    proc = _ffmpeg("-i", str(path), "-af", f"{_LOUDNORM}:print_format=json", "-f", "null", "-")
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", proc.stderr.decode(errors="replace"), re.S)
    if not match:
        raise RuntimeError("loudness measurement failed")
    data = json.loads(match.group(0))
    return {k: float(data[k]) for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")}


def encode(src: Path, dst: Path, measured: dict) -> None:
    af = (
        f"{_LOUDNORM}:measured_I={measured['input_i']}:measured_TP={measured['input_tp']}"
        f":measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}"
        f":offset={measured['target_offset']}:linear=true"
    )
    _ffmpeg(
        "-y", "-i", str(src), "-vn", "-af", af, "-ar", "44100",
        "-c:a", "aac", "-b:a", str(config.AAC_BITRATE), "-movflags", "+faststart", str(dst),
    )


def duration_ms(path: Path) -> int:
    proc = subprocess.run(
        [config.FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, check=True, text=True,
    )
    return int(float(proc.stdout.strip()) * 1000)


def waveform(path: Path, points: int = config.WAVEFORM_POINTS) -> list[float]:
    raw = _ffmpeg("-i", str(path), "-ac", "1", "-ar", "4000", "-f", "s16le", "-").stdout
    samples = array("h")
    samples.frombytes(raw[: len(raw) - len(raw) % 2])
    if not samples:
        return [0.0] * points
    step = max(1, len(samples) // points)
    peaks = []
    for i in range(points):
        chunk = samples[i * step : (i + 1) * step]
        peaks.append(round(max((abs(x) for x in chunk), default=0) / 32768, 3))
    return peaks


def store(path: Path, kind: str = "audio", ext: str = "m4a") -> dict:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    sha = digest.hexdigest()
    rel = Path(kind) / sha[:2] / sha[2:4] / f"{sha}.{ext}"
    dest = config.MEDIA_ROOT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        shutil.move(str(path), dest)
    return {"sha256": sha, "path": rel.as_posix(), "bytes": dest.stat().st_size}


def ingest(provider: str, external_id: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="jobbos-") as tmp:
        workdir = Path(tmp)
        src, meta = download(source_url(provider, external_id), workdir)
        measured = measure_loudness(src)
        out = workdir / "out.m4a"
        encode(src, out, measured)
        length = duration_ms(out)
        peaks = waveform(out)
        stored = store(out)
    asset = {
        **stored,
        "kind": "audio",
        "mime": "audio/mp4",
        "duration_ms": length,
        "bitrate": config.AAC_BITRATE,
        "loudness_lufs": measured["input_i"],
        "true_peak_db": measured["input_tp"],
        "gain_db": round(config.TARGET_LUFS - measured["input_i"], 2),
        "waveform": peaks,
    }
    return {"asset": asset, "source": meta}
