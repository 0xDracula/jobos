from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from . import config

VERSION = 2

SR = 22050
N_FFT = 2048
HOP = 512
FPS = SR / HOP
MIN_BPM, MAX_BPM = 60.0, 200.0
PRIOR_BPM = 120.0
TIGHTNESS = 100.0
CHUNK = 1024

CHROMA_N = 8192
CHROMA_HOP = 4096
CHROMA_FMIN, CHROMA_FMAX = 65.0, 2100.0
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
MAJOR_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
MINOR_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"]
BLOCK_S = 0.4
SILENCE_DB = -50.0


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        [config.FFMPEG, "-v", "error", "-nostdin", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def onset_pulses(y: np.ndarray) -> np.ndarray:
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
    return np.maximum(0.0, flux - trend)


def standardize(pulses: np.ndarray) -> np.ndarray:
    std = pulses.std()
    return pulses / std if std > 0 else pulses


def onset_envelope(y: np.ndarray) -> np.ndarray:
    return standardize(onset_pulses(y))


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


def chroma(y: np.ndarray) -> np.ndarray | None:
    if len(y) < CHROMA_N:
        return None
    freqs = np.fft.rfftfreq(CHROMA_N, 1 / SR)
    band = np.flatnonzero((freqs >= CHROMA_FMIN) & (freqs <= CHROMA_FMAX))
    midi = 69 + 12 * np.log2(freqs[band] / 440.0)
    nearest = np.round(midi)
    fold = np.zeros((len(band), 12), dtype=np.float32)
    fold[np.arange(len(band)), nearest.astype(int) % 12] = np.clip(1 - 2 * np.abs(midi - nearest), 0, 1)
    frames = np.lib.stride_tricks.sliding_window_view(y, CHROMA_N)[::CHROMA_HOP]
    window = np.hanning(CHROMA_N).astype(np.float32)
    per_frame = []
    for start in range(0, len(frames), 128):
        mag = np.abs(np.fft.rfft(frames[start : start + 128] * window, axis=1))[:, band]
        per_frame.append(np.sqrt(mag) @ fold)
    c = np.vstack(per_frame)
    sums = c.sum(axis=1)
    keep = sums > 0.05 * np.median(sums) if sums.any() else np.zeros(len(sums), dtype=bool)
    if not keep.any():
        return None
    profile = (c[keep] / sums[keep, None]).mean(axis=0)
    return profile / profile.sum()


def estimate_key(profile: np.ndarray | None) -> tuple[str | None, float]:
    if profile is None or not np.isfinite(profile).all() or profile.std() == 0:
        return None, 0.5
    corr = lambda p: np.array([np.corrcoef(profile, np.roll(p, t))[0, 1] for t in range(12)])
    major, minor = corr(KK_MAJOR), corr(KK_MINOR)
    p_major = float(1 / (1 + np.exp(-10 * (major.max() - minor.max()))))
    if major.max() >= minor.max():
        return f"{MAJOR_NAMES[int(major.argmax())]} major", p_major
    return f"{MINOR_NAMES[int(minor.argmax())]} minor", p_major


def loudness_spread_db(y: np.ndarray) -> float | None:
    block = int(BLOCK_S * SR)
    n = len(y) // block
    if n < 3:
        return None
    rms = np.sqrt(np.mean(y[: n * block].reshape(n, block).astype(np.float64) ** 2, axis=1))
    db = 20 * np.log10(rms + 1e-9)
    db = db[db > SILENCE_DB]
    if len(db) < 3:
        return None
    return float(np.percentile(db, 95) - np.percentile(db, 10))


def spectral_centroid_hz(y: np.ndarray) -> float | None:
    if len(y) < N_FFT:
        return None
    frames = y[: len(y) // N_FFT * N_FFT].reshape(-1, N_FFT) * np.hanning(N_FFT).astype(np.float32)
    mag = np.abs(np.fft.rfft(frames, axis=1))
    total = mag.sum()
    if total <= 0:
        return None
    return float((mag.sum(axis=0) * np.fft.rfftfreq(N_FFT, 1 / SR)).sum() / total)


def onset_rate(env: np.ndarray) -> float:
    if len(env) < 3:
        return 0.0
    peaks = np.flatnonzero((env[1:-1] > env[:-2]) & (env[1:-1] >= env[2:]) & (env[1:-1] > 1.0)) + 1
    gap = int(0.05 * FPS) or 1
    kept, last = 0, -gap
    for p in peaks:
        if p - last >= gap:
            kept, last = kept + 1, p
    return kept / (len(env) / FPS)


def pulse_clarity(env: np.ndarray, bpm: float) -> float:
    centered = env - env.mean()
    n = len(centered)
    ac = np.fft.irfft(np.abs(np.fft.rfft(centered, 2 * n)) ** 2)[:n]
    if ac[0] <= 0:
        return 0.0
    lag = int(round(60.0 * FPS / bpm))
    values = [ac[k] for k in (lag, 2 * lag) if 0 < k < n]
    return float(max(values) / ac[0]) if values else 0.0


def on_beat_share(env: np.ndarray, beat_frames: np.ndarray, bpm: float, width: int = 2) -> float:
    total = env.sum()
    if not len(beat_frames) or total <= 0:
        return 0.0
    near = np.zeros(len(env), dtype=bool)
    for f in beat_frames:
        near[max(0, f - width) : f + width + 1] = True
    chance = min(1.0, (2 * width + 1) / (60.0 * FPS / bpm))
    if chance >= 1.0:
        return 0.0
    return clip01((env[near].sum() / total - chance) / (1.0 - chance))


def clip01(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


def scores(
    pulses: np.ndarray, env: np.ndarray, bpm: float | None, beat_frames: np.ndarray, spread_db: float | None,
    centroid_hz: float | None, p_major: float, source_lufs: float | None,
) -> dict:
    presence = clip01(float(pulses.mean()) / 0.02) if len(pulses) else 0.0
    density = clip01((18.0 - spread_db) / 12.0) if spread_db is not None else 0.0
    brightness = clip01(np.log2(centroid_hz / 700.0) / np.log2(3500.0 / 700.0)) if centroid_hz else 0.0
    onsets = presence * clip01((onset_rate(env) - 1.0) / 5.0)
    parts = [(0.35, density), (0.25, brightness), (0.20, onsets)]
    if source_lufs is not None:
        parts.append((0.20, clip01((source_lufs + 20.0) / 14.0)))
    energy = sum(w * v for w, v in parts) / sum(w for w, _ in parts)
    if bpm and len(beat_frames):
        pulse = clip01((pulse_clarity(env, bpm) - 0.1) / 0.6)
        share = clip01(on_beat_share(env, beat_frames, bpm) / 0.7)
        tempo_fit = max(float(np.exp(-0.5 * (np.log2(b / 120.0) / 0.5) ** 2)) for b in (bpm, 2 * bpm, bpm / 2))
        danceability = presence * (0.45 * pulse + 0.35 * share + 0.20 * tempo_fit)
        pace = clip01((bpm - 70.0) / 80.0)
    else:
        danceability, pace = 0.0, 0.0
    valence = 0.40 * p_major + 0.20 * pace + 0.20 * brightness + 0.20 * danceability
    return {"energy": round(energy, 3), "danceability": round(danceability, 3), "valence": round(valence, 3)}


def analyze_samples(y: np.ndarray, source_lufs: float | None = None) -> dict:
    pulses = onset_pulses(y)
    env = standardize(pulses)
    bpm = estimate_tempo(env)
    frames = track_beats(env, bpm) if bpm is not None else np.zeros(0, dtype=np.int64)
    beats_ms = ((frames * HOP + N_FFT / 2) / SR * 1000).round().astype(int).tolist()
    key, p_major = estimate_key(chroma(y))
    out = {"tempo_bpm": round(float(bpm), 1) if bpm is not None else None, "beats": beats_ms, "musical_key": key}
    if not y.any():
        out.update(energy=None, danceability=None, valence=None)
    else:
        out.update(scores(pulses, env, bpm, frames, loudness_spread_db(y), spectral_centroid_hz(y), p_major, source_lufs))
    out["analysis_version"] = VERSION
    return out


def analyze(path: Path, source_lufs: float | None = None) -> dict:
    return analyze_samples(decode(path), source_lufs)


EMPTY = {
    "tempo_bpm": None, "beats": None, "musical_key": None,
    "energy": None, "danceability": None, "valence": None, "analysis_version": None,
}


def safe_analyze(path: Path, source_lufs: float | None = None) -> dict:
    try:
        return analyze(path, source_lufs)
    except Exception:
        return dict(EMPTY)
