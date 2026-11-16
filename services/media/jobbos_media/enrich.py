from __future__ import annotations

import hashlib
import io
import re
import time
from collections.abc import Callable
from functools import lru_cache

import httpx
import numpy as np
from PIL import Image

from . import config, matching

DEEZER_URL = "https://api.deezer.com"
USER_AGENT = "Jobbos/0.1 (private music player)"
THUMB_SIZE = 300
MAX_IMAGE_BYTES = 10 << 20
PALETTE_SIZE = 5
FORMATS = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"), "WEBP": ("webp", "image/webp")}
_PLACEHOLDER_RE = re.compile(r"/images/(?:cover|artist)//")
_GOOGLE_SIZE_RE = re.compile(r"=w\d+-h\d+.*$")


@lru_cache(maxsize=1)
def _http() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30, follow_redirects=True)


def _deezer(path: str, params: dict | None = None) -> dict:
    for _ in range(3):
        r = _http().get(DEEZER_URL + path, params=params)
        r.raise_for_status()
        body = r.json()
        if (body.get("error") or {}).get("code") != 4:
            return body
        time.sleep(5)
    return body


def deezer_track(isrc: str) -> dict | None:
    body = _deezer(f"/track/isrc:{isrc}")
    return None if body.get("error") else body


def deezer_search(artist: str, title: str) -> list[dict]:
    return _deezer("/search", {"q": f'artist:"{artist}" track:"{title}"', "limit": 10}).get("data") or []


def fetch_image(url: str) -> bytes:
    with _http().stream("GET", url) as r:
        r.raise_for_status()
        data = bytearray()
        for chunk in r.iter_bytes():
            data += chunk
            if len(data) > MAX_IMAGE_BYTES:
                raise ValueError(f"image larger than {MAX_IMAGE_BYTES} bytes: {url}")
    return bytes(data)


def _real(url: str | None) -> str | None:
    return url if url and not _PLACEHOLDER_RE.search(url) else None


def larger_artwork(url: str) -> str:
    return _GOOGLE_SIZE_RE.sub("=w1200-h1200", url) if "googleusercontent.com" in url else url


def pick_deezer(payload: dict, by_isrc: Callable, search: Callable) -> dict | None:
    title = payload["title"]
    artists = payload.get("artists") or []
    duration_ms = payload.get("duration_ms")
    if payload.get("isrc"):
        t = by_isrc(payload["isrc"])
        same_length = bool(duration_ms and t and t.get("duration") and abs(t["duration"] - duration_ms / 1000) <= 3)
        if t and (same_length or matching.title_similarity(title, t.get("title") or "") >= 0.5):
            return t
    if not artists:
        return None
    best, best_score = None, 0.0
    for t in search(artists[0], title):
        if duration_ms and t.get("duration") and abs(t["duration"] - duration_ms / 1000) > 3:
            continue
        s = matching.title_similarity(title, t.get("title") or "") + matching.artist_similarity(
            artists, [(t.get("artist") or {}).get("name") or ""], ""
        )
        if s > best_score and s >= 1.4:
            best, best_score = t, s
    return best


_M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
_M_INV = np.linalg.inv(_M)
_WHITE = np.array([0.95047, 1.0, 1.08883])


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    xyz = lin @ _M.T / _WHITE
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], axis=1)


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    fy = (lab[:, 0] + 16) / 116
    f = np.stack([fy + lab[:, 1] / 500, fy, fy - lab[:, 2] / 200], axis=1)
    xyz = np.where(f > 6 / 29, f**3, 3 * (6 / 29) ** 2 * (f - 4 / 29)) * _WHITE
    lin = np.clip(xyz @ _M_INV.T, 0, 1)
    return np.clip(np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055), 0, 1)


def kmeans(points: np.ndarray, k: int, iterations: int = 25) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(0)
    centers = [points[rng.integers(len(points))]]
    for _ in range(1, k):
        d = np.min(((points[:, None, :] - np.array(centers)[None]) ** 2).sum(-1), axis=1)
        if d.sum() == 0:
            break
        centers.append(points[rng.choice(len(points), p=d / d.sum())])
    centers = np.array(centers)
    labels = np.zeros(len(points), dtype=int)
    for step in range(iterations):
        labels_new = ((points[:, None, :] - centers[None]) ** 2).sum(-1).argmin(1)
        if step > 0 and np.array_equal(labels_new, labels):
            break
        labels = labels_new
        for i in range(len(centers)):
            members = points[labels == i]
            if len(members):
                centers[i] = members.mean(0)
    return centers, labels


def palette(img: Image.Image, k: int = PALETTE_SIZE) -> list[dict]:
    small = img.convert("RGB").resize((64, 64), Image.Resampling.BILINEAR)
    lab = rgb_to_lab(np.asarray(small, dtype=np.float64).reshape(-1, 3) / 255)
    centers, labels = kmeans(lab, k)
    weights = np.bincount(labels, minlength=len(centers)) / len(labels)
    rgb = np.rint(lab_to_rgb(centers) * 255).astype(int)
    out = [
        {
            "hex": "#{:02x}{:02x}{:02x}".format(*rgb[i]),
            "weight": round(float(weights[i]), 3),
            "lab": [round(float(v), 1) for v in centers[i]],
        }
        for i in range(len(centers))
        if weights[i] > 0
    ]
    return sorted(out, key=lambda c: c["weight"], reverse=True)


def store_image(data: bytes, kind: str, with_palette: bool) -> dict:
    img = Image.open(io.BytesIO(data))
    img.load()
    if img.format not in FORMATS:
        raise ValueError(f"unsupported image format {img.format}")
    ext, mime = FORMATS[img.format]
    sha = hashlib.sha256(data).hexdigest()
    rel = f"{kind}/{sha[:2]}/{sha[2:4]}/{sha}.{ext}"
    dest = config.MEDIA_ROOT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        dest.write_bytes(data)
    thumb = dest.with_name(f"{sha}.{THUMB_SIZE}.jpg")
    if not thumb.exists():
        small = img.convert("RGB")
        small.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.Resampling.LANCZOS)
        small.save(thumb, "JPEG", quality=85, optimize=True)
    return {
        "sha256": sha,
        "path": rel,
        "kind": kind,
        "mime": mime,
        "bytes": len(data),
        "width": img.width,
        "height": img.height,
        "palette": palette(img) if with_palette else None,
    }


def enrich(
    payload: dict,
    by_isrc: Callable = deezer_track,
    search: Callable = deezer_search,
    fetch: Callable = fetch_image,
) -> dict:
    out = {"artwork": None, "artwork_source": None, "artist_image": None, "deezer_artist_id": None}
    track = pick_deezer(payload, by_isrc, search)
    album = (track or {}).get("album") or {}
    artist = (track or {}).get("artist") or {}

    if payload.get("need_artwork"):
        url, source = _real(album.get("cover_xl")), "deezer"
        if not url and payload.get("artwork_url"):
            url, source = larger_artwork(payload["artwork_url"]), "original"
        if url:
            out["artwork"] = store_image(fetch(url), "artwork", with_palette=True)
            out["artwork_source"] = source

    artists = payload.get("artists") or []
    picture = _real(artist.get("picture_xl"))
    if payload.get("need_artist_image") and picture and artists:
        if matching.similarity(artists[0], artist.get("name") or "") >= 0.6:
            out["artist_image"] = store_image(fetch(picture), "image", with_palette=False)
            out["deezer_artist_id"] = str(artist.get("id")) if artist.get("id") else None
    return out
