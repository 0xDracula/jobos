from __future__ import annotations

import logging
import subprocess
from pathlib import Path

import numpy as np
import yt_dlp

from . import config

log = logging.getLogger("jobbos.highlight")

CLIP_S = 30.0
HEAT_STEPS = 50

SR = 11025
N_FFT = 4096
HOP = 2048
POOL = 3
MIN_LAG_S = 15.0


def video_heatmap(video_id: str) -> tuple[list[dict] | None, float | None]:
    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True}
    if config.YTDLP_COOKIES:
        opts["cookiefile"] = config.YTDLP_COOKIES
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    return info.get("heatmap") or None, info.get("duration")


def per_second(heat: list[dict], duration_s: float) -> np.ndarray:
    n = max(1, int(np.ceil(duration_s)))
    out = np.zeros(n, dtype=np.float64)
    for seg in heat:
        a = max(0, int(np.floor(float(seg.get("start_time", 0)))))
        b = min(n, max(a + 1, int(np.ceil(float(seg.get("end_time", a + 1))))))
        out[a:b] = np.maximum(out[a:b], float(seg.get("value", 0)))
    return out


def resample(heat: list[dict], duration_s: float, steps: int = HEAT_STEPS) -> list[float]:
    secs = per_second(heat, duration_s)
    edges = np.linspace(0, len(secs), steps + 1)
    vals = [float(secs[int(edges[i]):max(int(edges[i]) + 1, int(edges[i + 1]))].mean()) for i in range(steps)]
    top = max(vals) or 1.0
    return [round(v / top, 2) for v in vals]


def replayed_start(heat: list[dict], duration_s: float, clip_s: float = CLIP_S) -> float:
    secs = per_second(heat, duration_s)
    if len(secs) <= clip_s:
        return 0.0
    skip = int(max(5, 0.04 * len(secs)))
    secs[:skip] = secs[skip:].min() if skip < len(secs) else 0
    w = int(clip_s)
    sums = np.convolve(secs, np.ones(w), mode="valid")
    return float(np.argmax(sums))


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        [config.FFMPEG, "-v", "error", "-nostdin", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def chroma(y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    frames = np.lib.stride_tricks.sliding_window_view(y, N_FFT)[::HOP]
    window = np.hanning(N_FFT).astype(np.float32)
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    band = (freqs >= 65) & (freqs <= 2100)
    pitch = np.round(12 * np.log2(freqs[band] / 440.0)).astype(int) % 12
    chroma_frames = np.zeros((len(frames), 12), dtype=np.float64)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    for i in range(0, len(frames), 256):
        mags = np.abs(np.fft.rfft(frames[i:i + 256] * window, axis=1))[:, band]
        for p in range(12):
            chroma_frames[i:i + 256, p] = mags[:, pitch == p].sum(axis=1)
    n = len(chroma_frames) // POOL
    c = chroma_frames[: n * POOL].reshape(n, POOL, 12).mean(axis=1)
    r = rms[: n * POOL].reshape(n, POOL).mean(axis=1)
    c /= np.linalg.norm(c, axis=1, keepdims=True) + 1e-9
    return c, r


def chorus_start(path: Path, clip_s: float = CLIP_S) -> float | None:
    y = decode(path)
    frame_s = HOP * POOL / SR
    if len(y) < SR * (clip_s * 2):
        return None
    c, rms = chroma(y)
    t = len(c)
    w = int(round(clip_s / frame_s))
    min_lag = int(round(MIN_LAG_S / frame_s))
    if t < w + min_lag:
        return None
    sim = c @ c.T
    best = np.zeros(t - w + 1)
    for lag in range(min_lag, t - w + 1):
        diag = np.diagonal(sim, offset=lag)
        sums = np.convolve(diag, np.ones(w), mode="valid") / w
        n = len(sums)
        best[:n] = np.maximum(best[:n], sums)
        best[lag:lag + n] = np.maximum(best[lag:lag + n], sums[: len(best) - lag])
    loud = np.convolve(rms, np.ones(w), mode="valid") / w
    loud = loud / (loud.max() or 1.0)
    score = best * (0.6 + 0.4 * loud[: len(best)])
    score[int(len(score) * 0.9):] = 0
    score[: max(int(round(15 / frame_s)), int(len(score) * 0.08))] = 0
    near = np.flatnonzero(score >= 0.95 * score.max())
    return float(near[0] * frame_s)


def find(payload: dict) -> dict:
    duration_s = (payload.get("duration_ms") or 0) / 1000
    video_id = payload.get("video_id") or ""
    if video_id:
        try:
            heat, length = video_heatmap(video_id)
            length = float(length or duration_s)
            if heat and length > CLIP_S:
                start = replayed_start(heat, length)
                return {"start_ms": int(start * 1000), "source": "replayed", "heat": resample(heat, length)}
        except Exception as e:
            log.warning("heatmap for %s: %s", video_id, e)
    path = payload.get("path") or ""
    if path:
        full = config.MEDIA_ROOT / path
        if full.exists():
            start = chorus_start(full)
            if start is not None:
                return {"start_ms": int(start * 1000), "source": "chorus", "heat": []}
    return {"start_ms": None, "source": "", "heat": []}
