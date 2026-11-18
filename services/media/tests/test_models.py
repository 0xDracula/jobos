import numpy as np
import pytest

from jobbos_media import config, models


def test_patches_cover_the_frames_with_the_hop_and_pad_short_tracks():
    m = np.arange(300 * 96, dtype=np.float32).reshape(300, 96)
    p = models.patches(m, 128, 62)
    assert p.shape == (3, 128, 96)
    assert (p[1, 0] == m[62]).all()
    short = models.patches(m[:50], 128, 62)
    assert short.shape == (1, 128, 96) and (short[0, 50:] == 0).all()


def test_scale_maps_deam_values_to_zero_one():
    assert models.scale(1) == 0 and models.scale(9) == 1 and models.scale(5) == 0.5
    assert models.scale(12) == 1


class FakeSession:
    def __init__(self, name, fn):
        self.name, self.fn = name, fn

    def get_inputs(self):
        return [type("I", (), {"name": self.name})()]

    def run(self, _, feeds):
        return self.fn(feeds[self.name])


def fake_models():
    ms = object.__new__(models.Models)
    ms.styles = [f"Genre---Style {i}" for i in range(400)]
    styles = np.zeros(400, dtype=np.float32)
    styles[7], styles[3] = 0.6, 0.2
    ms.effnet = FakeSession("melspectrogram", lambda x: [np.tile(styles, (len(x), 1)), np.ones((len(x), 1280), np.float32)])
    ms.musicnn = FakeSession("melspectrogram", lambda x: [np.zeros((len(x), 50)), np.zeros((len(x), 200), np.float32)])
    ms.heads = {k: (FakeSession("embeddings", lambda x: [np.tile([0.25, 0.75], (len(x), 1))]), 1)
                for k in ("happy", "sad", "relaxed", "aggressive", "voice")}
    ms.deam = FakeSession("model/Placeholder:0", lambda x: [np.tile([7.0, 3.0], (len(x), 1))])
    ms.deam_classes = ["valence", "arousal"]
    return ms


def test_analyze_features_averages_patches_into_track_results():
    r = models.analyze_features(np.zeros((400, 96), np.float32), fake_models())
    assert r["model_version"] == models.VERSION
    assert r["happy"] == r["voice"] == 0.75
    assert r["styles"][:2] == [{"name": "Genre---Style 7", "score": 0.6}, {"name": "Genre---Style 3", "score": 0.2}]
    assert r["valence"] == 0.75 and r["arousal"] == 0.25
    assert len(r["embedding"]) == 1280 and r["embedding"][0] == 1.0


@pytest.mark.skipif(not (config.MODELS_DIR / f"{models.EFFNET}.onnx").exists(), reason="models not fetched (make models)")
def test_melbands_and_real_models_give_results_in_range():
    t = np.arange(16000 * 6) / 16000
    y = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    m = models.melbands(y)
    assert m.shape[1] == 96 and len(m) > 300
    r = models.analyze_features(m)
    assert all(0 <= r[k] <= 1 for k in ("happy", "sad", "relaxed", "aggressive", "voice", "valence", "arousal"))
