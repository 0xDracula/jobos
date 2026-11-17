from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import tempfile
from array import array
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yt_dlp

from . import analysis, config

_SUMMARY_RE = re.compile(r"Summary:.*?\bI:\s+(-?(?:[\d.]+|inf)) LUFS.*?Peak:\s+(-?(?:[\d.]+|inf)) dBFS", re.S)


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
    level = measure_output(path)
    return {"input_i": level["lufs"], "input_tp": level["true_peak_db"]}


def gain_db(measured: dict) -> float:
    loudness = measured["input_i"]
    if not -70.0 < loudness < 10.0:
        return 0.0
    return round(min(config.TARGET_LUFS - loudness, config.MAX_GAIN_DB), 2)


def level_filter(gain: float, ceiling_db: float) -> str:
    up = 4 * config.SAMPLE_RATE
    limit = 10 ** (ceiling_db / 20)
    return (
        f"volume={gain:.2f}dB,aresample={up}:resampler=soxr:precision=28,"
        f"alimiter=limit={limit:.6f}:attack=5:release=50:level=false:latency=true,"
        f"aresample={config.SAMPLE_RATE}:resampler=soxr:precision=28"
    )


def encode(src: Path, dst: Path, gain: float, ceiling_db: float, coder: str = "fast", bitrate: int = config.AAC_BITRATE) -> None:
    _ffmpeg(
        "-y", "-i", str(src), "-vn", "-af", level_filter(gain, ceiling_db), "-ar", str(config.SAMPLE_RATE),
        "-c:a", "aac", "-aac_coder", coder, *config.AAC_OPTIONS, "-b:a", str(bitrate), "-movflags", "+faststart", str(dst),
    )


def measure_output(path: Path) -> dict:
    proc = _ffmpeg("-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-")
    m = _SUMMARY_RE.search(proc.stderr.decode(errors="replace"))
    if not m:
        raise RuntimeError("output measurement failed")
    floor = lambda v: max(float(v), -120.0)
    return {"lufs": floor(m.group(1)), "true_peak_db": floor(m.group(2))}


def encode_within_peak(src: Path, workdir: Path, measured: dict) -> tuple[Path, dict]:
    gain = gain_db(measured)
    made_up = gain == 0.0
    best: tuple[Path, dict] | None = None
    encodes = 0
    for attempt, (ceiling, coder, bitrate) in enumerate(config.ENCODES, 1):
        out = workdir / f"out-{attempt}.m4a"
        encode(src, out, gain, ceiling, coder, bitrate)
        encodes += 1
        level = {**measure_output(out), "bitrate": bitrate}
        shortfall = config.TARGET_LUFS - level["lufs"]
        if not made_up and shortfall > config.LOUDNESS_TOLERANCE and gain < config.MAX_GAIN_DB:
            made_up = True
            gain = round(min(gain + shortfall, config.MAX_GAIN_DB), 2)
            encode(src, out, gain, ceiling, coder, bitrate)
            encodes += 1
            level = {**measure_output(out), "bitrate": bitrate}
        if best is None or level["true_peak_db"] < best[1]["true_peak_db"]:
            kept = workdir / f"best-{attempt}.m4a"
            out.replace(kept)
            best = (kept, level)
        if level["true_peak_db"] <= config.TARGET_TRUE_PEAK:
            break
    out, level = best
    return out, {**level, "attempts": encodes}


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
        return {"asset": process(src, workdir), "source": meta}


def ingest_file(path: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="jobbos-") as tmp:
        return {"asset": process(path, Path(tmp))}


def process(src: Path, workdir: Path) -> dict:
    measured = measure_loudness(src)
    out, level = encode_within_peak(src, workdir, measured)
    length = duration_ms(out)
    peaks = waveform(out)
    features = analysis.safe_analyze(out, measured["input_i"])
    stored = store(out)
    return {
        **stored,
        "kind": "audio",
        "mime": "audio/mp4",
        "duration_ms": length,
        "bitrate": level["bitrate"],
        "loudness_lufs": measured["input_i"],
        "true_peak_db": measured["input_tp"],
        "gain_db": round(level["lufs"] - measured["input_i"], 2),
        "output_lufs": level["lufs"],
        "output_true_peak_db": level["true_peak_db"],
        "waveform": peaks,
        **features,
    }
