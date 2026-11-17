import shutil
import subprocess
from pathlib import Path

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
    ingest.encode(tone, out, ingest.gain_db(measured), -2.0)
    after = ingest.measure_loudness(out)
    assert abs(after["input_i"] - config.TARGET_LUFS) < 1.0
    assert after["input_tp"] <= config.TARGET_TRUE_PEAK


def lavfi(tmp_path, name: str, graph: str) -> Path:
    path = tmp_path / name
    subprocess.run([config.FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", graph,
                    "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(path)], check=True)
    return path


def test_gain_is_linear_capped_and_none_for_silence():
    assert ingest.gain_db({"input_i": -8.0}) == -6.0
    assert ingest.gain_db({"input_i": -30.0}) == 16.0
    assert ingest.gain_db({"input_i": -60.0}) == config.MAX_GAIN_DB
    assert ingest.gain_db({"input_i": float("-inf")}) == 0.0


def test_limiter_runs_oversampled_without_auto_level():
    f = ingest.level_filter(-6.0, -2.0)
    assert f.startswith("volume=-6.00dB,aresample=176400:resampler=soxr")
    assert "alimiter=limit=0.794328:attack=5:release=50:level=false:latency=true" in f
    assert f.endswith("aresample=44100:resampler=soxr:precision=28")


def test_clipped_loud_source_is_leveled_and_limited(tmp_path):
    src = lavfi(tmp_path, "loud.wav", "anoisesrc=d=8:c=pink:a=0.5:seed=7,volume=15dB")
    measured = ingest.measure_loudness(src)
    assert measured["input_i"] > -10 and measured["input_tp"] > 0
    out, level = ingest.encode_within_peak(src, tmp_path, measured)
    assert level["true_peak_db"] <= config.TARGET_TRUE_PEAK
    assert abs(level["lufs"] - config.TARGET_LUFS) <= 0.5
    assert level["bitrate"] in {b for _, _, b in config.ENCODES} and level["attempts"] >= 1
    assert abs(ingest.duration_ms(out) - ingest.duration_ms(src)) < 50


def test_quiet_source_with_peaks_is_raised_and_limited(tmp_path):
    src = lavfi(tmp_path, "quiet.wav", "anoisesrc=d=8:c=pink:a=0.05:seed=3,"
                "volume='if(lt(mod(t,1),0.002),18,1)':eval=frame")
    measured = ingest.measure_loudness(src)
    assert measured["input_i"] < -22
    out, level = ingest.encode_within_peak(src, tmp_path, measured)
    assert level["true_peak_db"] <= config.TARGET_TRUE_PEAK
    assert abs(level["lufs"] - config.TARGET_LUFS) <= config.LOUDNESS_TOLERANCE
    assert level["attempts"] >= 2


def test_silence_is_stored_without_gain(tmp_path):
    src = lavfi(tmp_path, "silence.wav", "anullsrc=r=44100:cl=stereo:d=3")
    measured = ingest.measure_loudness(src)
    assert ingest.gain_db(measured) == 0.0
    out, level = ingest.encode_within_peak(src, tmp_path, measured)
    assert out.exists() and level["true_peak_db"] <= config.TARGET_TRUE_PEAK and level["attempts"] == 1


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


def test_stream_info():
    from jobbos_media.ingest import stream_info

    info = {
        "url": "https://rr3---sn-x.googlevideo.com/videoplayback?expire=1795000000&itag=140&n=abc",
        "http_headers": {"User-Agent": "Mozilla/5.0"},
        "ext": "m4a",
        "filesize": 3426450,
        "duration": 212,
    }
    assert stream_info(info) == {
        "url": info["url"],
        "headers": {"User-Agent": "Mozilla/5.0"},
        "mime": "audio/mp4",
        "bytes": 3426450,
        "duration_ms": 212000,
        "expires_at": 1795000000,
    }
    assert stream_info({"url": "https://x.googlevideo.com/v", "ext": "webm"})["mime"] == "audio/webm"


def test_encoded_file_is_measured_within_the_peak_limit(tone, tmp_path):
    from jobbos_media import config

    measured = ingest.measure_loudness(tone)
    out, level = ingest.encode_within_peak(tone, tmp_path, measured)
    assert out.exists()
    assert abs(level["lufs"] - config.TARGET_LUFS) < 1.0
    assert level["true_peak_db"] <= config.TARGET_TRUE_PEAK
    assert level == {**ingest.measure_output(out), "bitrate": config.AAC_BITRATE, "attempts": 1}
