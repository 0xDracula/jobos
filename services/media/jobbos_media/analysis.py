from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from . import config

SR = 22050
N_FFT = 2048
HOP = 512
FPS = SR / HOP
MIN_BPM, MAX_BPM = 60.0, 200.0
PRIOR_BPM = 120.0
TIGHTNESS = 100.0
CHUNK = 1024


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        [config.FFMPEG, "-v", "error", "-nostdin", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def onset_envelope(y: np.ndarray) -> np.ndarray:
    if len(y) < N_FFT * 2:
        return np.zeros(0, dtype=np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(y, N_FFT)[::HOP]
    window = np.hanning(N_FFT).astype(np.float32)
    top = int(8000 / (SR / N_FFT))
    flux = np.zeros(len(frames), dtype=np.float32)
    prev = None
    for start in range(0, len(frames), CHUNK):
        chunk = frames[start : start + CHUNK] * window
        mag = np.log1p(100.0 * np.abs(np.fft.rfft(chunk, axis=1))[:, :top]).astype(np.float32)
        if prev is not None:
            mag_all = np.vstack([prev[None, :], mag])
        else:
            mag_all = np.vstack([mag[:1], mag])
        diff = np.maximum(0.0, np.diff(mag_all, axis=0))
        flux[start : start + len(chunk)] = diff.mean(axis=1)
        prev = mag[-1]
    trend = np.convolve(flux, np.ones(int(FPS)) / int(FPS), mode="same")
    env = np.maximum(0.0, flux - trend)
    std = env.std()
    return env / std if std > 0 else env


def estimate_tempo(env: np.ndarray) -> float | None:
    if len(env) < FPS * 8 or not env.any():
        return None
    n = len(env)
    centered = env - env.mean()
    spectrum = np.fft.rfft(centered, 2 * n)
    ac = np.fft.irfft(spectrum * np.conj(spectrum))[:n]
    min_lag = int(np.floor(60.0 * FPS / MAX_BPM))
    max_lag = min(n - 2, int(np.ceil(60.0 * FPS / MIN_BPM)))
    lags = np.arange(min_lag, max_lag + 1)
    bpms = 60.0 * FPS / lags
    prior = np.exp(-0.5 * (np.log2(bpms / PRIOR_BPM) / 0.9) ** 2)
    score = ac[lags] * prior
    best = int(np.argmax(score))
    lag = float(lags[best])
    if 0 < best < len(lags) - 1:
        a, b, c = score[best - 1], score[best], score[best + 1]
        denom = a - 2 * b + c
        if denom != 0:
            lag += 0.5 * (a - c) / denom
    return 60.0 * FPS / lag


def track_beats(env: np.ndarray, bpm: float) -> np.ndarray:
    period = 60.0 * FPS / bpm
    width = max(1, int(round(period / 16)))
    kernel = np.exp(-0.5 * (np.arange(-2 * width, 2 * width + 1) / width) ** 2)
    local = np.convolve(env, kernel, mode="same")
    n = len(local)
    backlink = np.full(n, -1, dtype=np.int64)
    cumscore = np.zeros(n)
    window = np.arange(-int(round(2 * period)), -int(round(period / 2)) + 1)
    weights = -TIGHTNESS * np.log(-window / period) ** 2
    threshold = 0.01 * local.max()
    started = False
    for i in range(n):
        idx = i + window
        valid = idx >= 0
        candidates = np.full(len(window), -np.inf)
        candidates[valid] = weights[valid] + cumscore[idx[valid]]
        if valid.any():
            best = int(np.argmax(candidates))
            cumscore[i] = local[i] + candidates[best]
        else:
            cumscore[i] = local[i]
        if not started and local[i] < threshold:
            backlink[i] = -1
        else:
            backlink[i] = idx[best] if valid.any() else -1
            started = True
    peaks = np.flatnonzero((cumscore[1:-1] > cumscore[:-2]) & (cumscore[1:-1] >= cumscore[2:])) + 1
    if not len(peaks):
        return np.zeros(0, dtype=np.int64)
    median = np.median(cumscore[peaks])
    last = peaks[cumscore[peaks] > 0.5 * median].max() if (cumscore[peaks] > 0.5 * median).any() else peaks.max()
    beats = [int(last)]
    while backlink[beats[-1]] >= 0:
        beats.append(int(backlink[beats[-1]]))
    beats = np.array(beats[::-1], dtype=np.int64)
    strength = local[beats]
    keep = np.flatnonzero(strength >= 0.5 * np.sqrt(np.mean(strength**2)))
    return beats[keep[0] : keep[-1] + 1] if len(keep) else beats


def analyze_samples(y: np.ndarray) -> dict:
    env = onset_envelope(y)
    bpm = estimate_tempo(env)
    if bpm is None:
        return {"tempo_bpm": None, "beats": []}
    frames = track_beats(env, bpm)
    beats_ms = ((frames * HOP + N_FFT / 2) / SR * 1000).round().astype(int).tolist()
    return {"tempo_bpm": round(float(bpm), 1), "beats": beats_ms}


def analyze(path: Path) -> dict:
    return analyze_samples(decode(path))


def safe_analyze(path: Path) -> dict:
    try:
        return analyze(path)
    except Exception:
        return {"tempo_bpm": None, "beats": None}
