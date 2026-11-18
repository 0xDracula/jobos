from __future__ import annotations

import json
import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np

from . import config

VERSION = 1

SR = 16000
FRAME, HOP = 512, 256
EFFNET_PATCH, EFFNET_HOP = 128, 62
MUSICNN_PATCH, MUSICNN_HOP = 187, 93
BATCH = 64
MAX_S = 900
STYLES = 5
STYLE_MIN = 0.05

EFFNET = "discogs-effnet-bsdynamic-1"
MUSICNN = "msd-musicnn-1"
HEADS = {
    "happy": ("mood_happy-discogs-effnet-1", "happy"),
    "sad": ("mood_sad-discogs-effnet-1", "sad"),
    "relaxed": ("mood_relaxed-discogs-effnet-1", "relaxed"),
    "aggressive": ("mood_aggressive-discogs-effnet-1", "aggressive"),
    "voice": ("voice_instrumental-discogs-effnet-1", "voice"),
}
DEAM = "deam-msd-musicnn-2"


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        [config.FFMPEG, "-v", "error", "-nostdin", "-i", str(path), "-t", str(MAX_S), "-ac", "1", "-ar", str(SR),
         "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


@lru_cache(maxsize=1)
def _essentia():
    import essentia

    essentia.log.infoActive = False
    import essentia.standard as es

    return es


def melbands(y: np.ndarray) -> np.ndarray:
    es = _essentia()
    if len(y) < FRAME:
        y = np.pad(y, (0, FRAME - len(y)))
    features = es.TensorflowInputMusiCNN()
    rows = [features(frame) for frame in es.FrameGenerator(np.ascontiguousarray(y), frameSize=FRAME, hopSize=HOP,
                                                            startFromZero=True, validFrameThresholdRatio=1)]
    return np.asarray(rows, dtype=np.float32).reshape(-1, 96)


def patches(m: np.ndarray, size: int, hop: int) -> np.ndarray:
    if len(m) < size:
        m = np.pad(m, ((0, size - len(m)), (0, 0)))
    starts = range(0, len(m) - size + 1, hop)
    return np.stack([m[s : s + size] for s in starts]).astype(np.float32)


class Models:
    def __init__(self, root: Path):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = config.MODEL_THREADS
        opts.log_severity_level = 3

        def load(name: str):
            path = root / f"{name}.onnx"
            if not path.exists():
                raise FileNotFoundError(f"model {path} missing: run make models")
            meta = json.loads((root / f"{name}.json").read_text())
            return ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"]), meta

        self.effnet, meta = load(EFFNET)
        self.styles = meta["classes"]
        self.musicnn, _ = load(MUSICNN)
        self.heads = {}
        for key, (name, positive) in HEADS.items():
            session, meta = load(name)
            self.heads[key] = (session, meta["classes"].index(positive))
        self.deam, meta = load(DEAM)
        self.deam_classes = meta["classes"]


@lru_cache(maxsize=1)
def models() -> Models:
    return Models(config.MODELS_DIR)


def run(session, name: str, x: np.ndarray) -> list[np.ndarray]:
    outs: list[list[np.ndarray]] = []
    for start in range(0, len(x), BATCH):
        res = session.run(None, {name: x[start : start + BATCH]})
        if not outs:
            outs = [[] for _ in res]
        for i, r in enumerate(res):
            outs[i].append(r)
    return [np.concatenate(o) for o in outs]


def scale(v: float) -> float:
    return float(np.clip((v - 1) / 8, 0, 1))


def analyze_features(m: np.ndarray, ms: Models | None = None) -> dict:
    ms = ms or models()
    styles, emb = run(ms.effnet, ms.effnet.get_inputs()[0].name, patches(m, EFFNET_PATCH, EFFNET_HOP))
    out: dict = {"model_version": VERSION}
    for key, (session, positive) in ms.heads.items():
        (probs,) = run(session, session.get_inputs()[0].name, emb)
        out[key] = round(float(probs[:, positive].mean()), 4)
    mean_styles = styles.mean(axis=0)
    top = np.argsort(mean_styles)[::-1][:STYLES]
    out["styles"] = [{"name": ms.styles[i], "score": round(float(mean_styles[i]), 4)} for i in top
                     if mean_styles[i] >= STYLE_MIN]
    _, cnn = run(ms.musicnn, ms.musicnn.get_inputs()[0].name, patches(m, MUSICNN_PATCH, MUSICNN_HOP))
    (va,) = run(ms.deam, ms.deam.get_inputs()[0].name, cnn)
    va = va.mean(axis=0)
    out["valence"] = round(scale(va[ms.deam_classes.index("valence")]), 4)
    out["arousal"] = round(scale(va[ms.deam_classes.index("arousal")]), 4)
    out["embedding"] = [round(float(v), 5) for v in emb.mean(axis=0)]
    return out


def analyze(path: Path) -> dict:
    return analyze_features(melbands(decode(path)))
