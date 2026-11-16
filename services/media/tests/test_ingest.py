import shutil
import subprocess

import pytest

from jobbos_media import config, ingest

pytestmark = pytest.mark.skipif(shutil.which(config.FFMPEG) is None, reason="ffmpeg not installed")


@pytest.fixture
def tone(tmp_path):
    path = tmp_path / "tone.m4a"
    subprocess.run(
        [config.FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
         "-af", "volume=-20dB", "-c:a", "aac", str(path)],
        check=True,
    )
    return path


def test_loudness_is_measured_and_normalized(tone, tmp_path):
    measured = ingest.measure_loudness(tone)
    assert measured["input_i"] < -20
    out = tmp_path / "out.m4a"
    ingest.encode(tone, out, measured)
    after = ingest.measure_loudness(out)
    assert abs(after["input_i"] - config.TARGET_LUFS) < 2.0
    assert after["input_tp"] <= config.TARGET_TRUE_PEAK + 0.5


def test_waveform_has_fixed_length(tone):
    peaks = ingest.waveform(tone, points=64)
    assert len(peaks) == 64
    assert all(0 <= p <= 1 for p in peaks)
    assert max(peaks) > 0


def test_store_is_content_addressed(tone, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MEDIA_ROOT", tmp_path / "media")
    stored = ingest.store(tone)
    sha = stored["sha256"]
    assert stored["path"] == f"audio/{sha[:2]}/{sha[2:4]}/{sha}.m4a"
    assert (tmp_path / "media" / stored["path"]).exists()


def test_highlight_picks_the_most_replayed_segment():
    heatmap = [{"start_time": 0, "end_time": 5, "value": 0.2}, {"start_time": 60, "end_time": 65, "value": 1.0}]
    assert ingest.highlight(heatmap) == {"start_ms": 60_000, "end_ms": 65_000}
    assert ingest.highlight(None) is None


def test_source_url():
    assert ingest.source_url("ytmusic", "abc123") == "https://www.youtube.com/watch?v=abc123"
    assert ingest.source_url("soundcloud", "https://soundcloud.com/a/b") == "https://soundcloud.com/a/b"
    with pytest.raises(ValueError):
        ingest.source_url("upload", "file")
