import numpy as np

from jobbos_media import highlight


def test_replayed_start_skips_the_opening_and_finds_the_peak():
    heat = [{"start_time": i * 2, "end_time": i * 2 + 2, "value": 0.3} for i in range(100)]
    heat[0]["value"] = 1.0
    for i in range(60, 68):
        heat[i]["value"] = 0.9
    start = highlight.replayed_start(heat, 200.0)
    assert 100 <= start <= 125, start


def test_resample_scales_to_fifty_steps():
    heat = [{"start_time": i, "end_time": i + 1, "value": v} for i, v in enumerate(np.linspace(0, 0.5, 120))]
    out = highlight.resample(heat, 120.0)
    assert len(out) == 50
    assert max(out) == 1.0 and out[0] == 0.0


def test_chorus_start_finds_the_repeated_part(tmp_path, monkeypatch):
    sr = highlight.SR
    rng = np.random.default_rng(1)

    def tone(freqs, seconds):
        t = np.arange(int(sr * seconds)) / sr
        return sum(np.sin(2 * np.pi * f * t) for f in freqs).astype(np.float32) * 0.2

    verse_a = tone([220.0, 277.2], 40) + rng.normal(0, 0.01, int(sr * 40)).astype(np.float32)
    chorus = tone([392.0, 493.9, 587.3], 30)
    verse_b = tone([246.9, 311.1], 40) + rng.normal(0, 0.01, int(sr * 40)).astype(np.float32)
    y = np.concatenate([verse_a, chorus, verse_b, chorus, verse_a[: sr * 10]])
    monkeypatch.setattr(highlight, "decode", lambda _path: y)
    start = highlight.chorus_start(tmp_path / "song.m4a")
    assert start is not None
    assert min(abs(start - 40), abs(start - 110)) < 4, start


def test_find_without_video_or_file_finds_nothing():
    assert highlight.find({"track_id": "x", "duration_ms": 200000})["start_ms"] is None
