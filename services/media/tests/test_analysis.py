import numpy as np
import pytest

from jobbos_media import analysis


def click_track(bpm: float, seconds: float = 30.0, offset: float = 0.25, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    sr = analysis.SR
    y = rng.normal(0, 0.01, int(sr * seconds)).astype(np.float32)
    burst = (rng.normal(0, 0.6, int(0.03 * sr)) * np.exp(-np.linspace(0, 6, int(0.03 * sr)))).astype(np.float32)
    t = offset
    while t < seconds - 0.05:
        i = int(t * sr)
        y[i : i + len(burst)] += burst
        t += 60.0 / bpm
    return y


@pytest.mark.parametrize("bpm", [90.0, 120.0, 128.0, 150.0])
def test_tempo_and_beats_follow_a_click_track(bpm):
    result = analysis.analyze_samples(click_track(bpm))
    assert result["tempo_bpm"] == pytest.approx(bpm, rel=0.03)
    beats = np.array(result["beats"]) / 1000.0
    assert len(beats) >= 0.8 * 30 * bpm / 60
    gaps = np.diff(beats)
    assert np.median(gaps) == pytest.approx(60.0 / bpm, rel=0.03)
    expected = 0.25 + 60.0 / bpm * np.round((beats - 0.25) / (60.0 / bpm))
    assert np.median(np.abs(beats - expected)) < 0.05


def test_silence_has_no_beats():
    result = analysis.analyze_samples(np.zeros(analysis.SR * 10, dtype=np.float32))
    assert result == {"tempo_bpm": None, "beats": []}


def test_short_audio_has_no_beats():
    result = analysis.analyze_samples(click_track(120.0, seconds=3.0))
    assert result["tempo_bpm"] is None


def test_media_path_refuses_files_outside_audio(tmp_path, monkeypatch):
    from jobbos_media import config, worker

    monkeypatch.setattr(config, "MEDIA_ROOT", tmp_path)
    (tmp_path / "audio" / "ab").mkdir(parents=True)
    assert worker.media_path("audio/ab/x.m4a") == (tmp_path / "audio" / "ab" / "x.m4a").resolve()
    for bad in ["../etc/passwd", "uploads/x.m4a", "audio/../../x"]:
        with pytest.raises(ValueError):
            worker.media_path(bad)
