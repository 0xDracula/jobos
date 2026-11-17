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
    assert result == {
        "tempo_bpm": None, "beats": [], "musical_key": None,
        "energy": None, "danceability": None, "valence": None, "analysis_version": analysis.VERSION,
    }


def test_short_audio_has_no_beats():
    result = analysis.analyze_samples(click_track(120.0, seconds=3.0))
    assert result["tempo_bpm"] is None
    assert result["analysis_version"] == analysis.VERSION


NOTE = {"C": 0, "C#": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "Bb": 10, "B": 11}


def chords(progression: list[list[str]], seconds_each: float = 2.0, repeats: int = 3) -> np.ndarray:
    sr = analysis.SR
    t = np.arange(int(sr * seconds_each)) / sr
    fade = np.minimum(1, np.minimum(t, t[::-1]) / 0.05)
    parts = []
    for _ in range(repeats):
        for chord in progression:
            y = np.zeros_like(t)
            for name in chord:
                f = 261.63 * 2 ** (NOTE[name] / 12)
                for h in range(1, 5):
                    y += np.sin(2 * np.pi * f * h * t) / h
            parts.append(0.1 * y * fade)
    return np.concatenate(parts).astype(np.float32)


def test_key_of_a_minor_and_a_major_progression():
    minor = analysis.analyze_samples(chords([["A", "C", "E"], ["D", "F", "A"], ["E", "G#", "B"], ["A", "C", "E"]]))
    assert minor["musical_key"] == "A minor"
    major = analysis.analyze_samples(chords([["C", "E", "G"], ["F", "A", "C"], ["G", "B", "D"], ["C", "E", "G"]]))
    assert major["musical_key"] == "C major"
    assert major["valence"] > minor["valence"]


def test_key_names_follow_the_profile_rotation():
    profile = np.roll(analysis.KK_MINOR, NOTE["F#"]) / analysis.KK_MINOR.sum()
    assert analysis.estimate_key(profile)[0] == "F♯ minor"
    profile = np.roll(analysis.KK_MAJOR, NOTE["Bb"]) / analysis.KK_MAJOR.sum()
    key, p_major = analysis.estimate_key(profile)
    assert key == "B♭ major" and p_major > 0.5
    assert analysis.estimate_key(None) == (None, 0.5)


def soft_pad(seconds: float = 30.0) -> np.ndarray:
    sr = analysis.SR
    t = np.arange(int(sr * seconds)) / sr
    swell = 0.02 + 0.3 * (0.5 + 0.5 * np.sin(2 * np.pi * t / 10)) ** 3
    y = sum(np.sin(2 * np.pi * f * t) for f in (220.0, 277.18, 329.63))
    return (swell * y / 3).astype(np.float32)


def drum_loop(bpm: float = 128.0, seconds: float = 30.0) -> np.ndarray:
    rng = np.random.default_rng(3)
    sr = analysis.SR
    y = rng.normal(0, 0.15, int(sr * seconds)).astype(np.float32)
    burst = (rng.normal(0, 0.8, int(0.04 * sr)) * np.exp(-np.linspace(0, 5, int(0.04 * sr)))).astype(np.float32)
    t = 0.1
    while t < seconds - 0.1:
        i = int(t * sr)
        y[i : i + len(burst)] += burst
        t += 30.0 / bpm
    return y


def test_scores_rank_a_drum_loop_above_a_soft_pad():
    loud = analysis.analyze_samples(drum_loop(), source_lufs=-7.0)
    soft = analysis.analyze_samples(soft_pad(), source_lufs=-18.0)
    for key in ("energy", "danceability", "valence"):
        assert 0.0 <= loud[key] <= 1.0 and 0.0 <= soft[key] <= 1.0
    assert loud["energy"] > 0.7 > 0.3 > soft["energy"]
    assert loud["danceability"] > 0.6 > soft["danceability"]
    assert loud["analysis_version"] == analysis.VERSION


def test_energy_without_source_loudness_uses_the_other_features():
    loop = drum_loop()
    with_lufs = analysis.analyze_samples(loop, source_lufs=-7.0)["energy"]
    without = analysis.analyze_samples(loop)["energy"]
    assert abs(with_lufs - without) < 0.15


def test_regular_beats_are_more_danceable_than_irregular_clicks():
    regular = analysis.analyze_samples(click_track(120.0))
    rng = np.random.default_rng(5)
    sr = analysis.SR
    y = rng.normal(0, 0.01, sr * 30).astype(np.float32)
    burst = (rng.normal(0, 0.6, int(0.03 * sr)) * np.exp(-np.linspace(0, 6, int(0.03 * sr)))).astype(np.float32)
    for t in np.sort(rng.uniform(0.2, 29.5, 60)):
        i = int(t * sr)
        y[i : i + len(burst)] += burst
    irregular = analysis.analyze_samples(y)
    assert regular["danceability"] > irregular["danceability"] + 0.2


def test_media_path_refuses_files_outside_audio(tmp_path, monkeypatch):
    from jobbos_media import config, worker

    monkeypatch.setattr(config, "MEDIA_ROOT", tmp_path)
    (tmp_path / "audio" / "ab").mkdir(parents=True)
    assert worker.media_path("audio/ab/x.m4a") == (tmp_path / "audio" / "ab" / "x.m4a").resolve()
    for bad in ["../etc/passwd", "uploads/x.m4a", "audio/../../x"]:
        with pytest.raises(ValueError):
            worker.media_path(bad)
