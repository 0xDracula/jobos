from __future__ import annotations

import time
from collections.abc import Callable
from functools import lru_cache

import httpx

from . import matching
from .search import _client as ytmusic_client

LRCLIB_URL = "https://lrclib.net/api"
USER_AGENT = "Jobbos/0.1 (private music player)"
DURATION_TOLERANCE_S = 3
MIN_SIMILARITY = 0.6
LRCLIB_INTERVAL_S = 1.0
LRCLIB_TRIES = 3
_last_request = 0.0


@lru_cache(maxsize=1)
def _lrclib() -> httpx.Client:
    return httpx.Client(base_url=LRCLIB_URL, headers={"User-Agent": USER_AGENT}, timeout=30)


def _lrclib_get(path: str, params: dict) -> httpx.Response:
    global _last_request
    for _ in range(LRCLIB_TRIES):
        wait = _last_request + LRCLIB_INTERVAL_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        r = _lrclib().get(path, params=params)
        if r.status_code != 429:
            return r
        retry_after = r.headers.get("Retry-After", "")
        time.sleep(min(float(retry_after), 60.0) if retry_after.isdigit() else 10.0)
    return r


def lrclib_get(title: str, artist: str, album: str, duration_s: int) -> dict | None:
    r = _lrclib_get(
        "/get", {"track_name": title, "artist_name": artist, "album_name": album, "duration": duration_s}
    )
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def lrclib_search(title: str, artist: str) -> list[dict]:
    r = _lrclib_get("/search", {"track_name": title, "artist_name": artist})
    r.raise_for_status()
    return r.json()


def ytmusic_lyrics(video_id: str) -> dict | None:
    yt = ytmusic_client()
    browse_id = yt.get_watch_playlist(videoId=video_id, limit=1).get("lyrics")
    if not browse_id:
        return None
    found = yt.get_lyrics(browse_id, timestamps=True) or {}
    lines = found.get("lyrics")
    if not lines:
        return None
    if found.get("hasTimestamps") and isinstance(lines, list):
        return {"synced": [(int(line.start_time), line.text) for line in lines]}
    if isinstance(lines, list):
        return {"plain": "\n".join(line.text for line in lines)}
    return {"plain": lines}


def to_lrc(lines: list[tuple[int, str]]) -> str:
    out = []
    for ms, text in lines:
        cs = ms // 10
        minutes, rest = divmod(cs, 6000)
        out.append(f"[{minutes:02d}:{rest // 100:02d}.{rest % 100:02d}] {text}".rstrip())
    return "\n".join(out)


def _rank(record: dict) -> int:
    return 3 if record.get("syncedLyrics") else 2 if record.get("plainLyrics") else 1 if record.get("instrumental") else 0


def best_lrclib(records: list[dict], title: str, artists: list[str], duration_ms: int | None) -> dict | None:
    best, best_key = None, None
    for r in records:
        if duration_ms and r.get("duration") and abs(r["duration"] - duration_ms / 1000) > DURATION_TOLERANCE_S:
            continue
        name = r.get("trackName") or r.get("name") or ""
        t = matching.title_similarity(title, name)
        a = matching.artist_similarity(artists, [r.get("artistName") or ""], name)
        if t < MIN_SIMILARITY or a < MIN_SIMILARITY or not _rank(r):
            continue
        key = (_rank(r), t + a)
        if best_key is None or key > best_key:
            best, best_key = r, key
    return best


Lookup = Callable[..., object]


def fetch_lyrics(
    payload: dict,
    get: Lookup = lrclib_get,
    search: Lookup = lrclib_search,
    ytm: Lookup = ytmusic_lyrics,
) -> dict:
    title = payload["title"]
    artists = payload.get("artists") or []
    album = payload.get("album") or ""
    duration_ms = payload.get("duration_ms")
    artist = artists[0] if artists else ""

    record = None
    if artist and album and duration_ms:
        found = get(title, artist, album, round(duration_ms / 1000))
        if found and _rank(found):
            record = found
    if not (record and record.get("syncedLyrics")) and artist:
        record = best_lrclib(search(title, artist), title, artists, duration_ms) or record
    lrclib_ms = round(record["duration"] * 1000) if record and record.get("duration") else None
    if record and record.get("syncedLyrics"):
        return result("lrclib", record["syncedLyrics"], record.get("plainLyrics"), False, lrclib_ms)

    plain = ("lrclib", record["plainLyrics"], lrclib_ms) if record and record.get("plainLyrics") else None
    if payload.get("external_id"):
        found = ytm(payload["external_id"])
        file_ms = payload.get("file_duration_ms")
        if found and found.get("synced"):
            text = "\n".join(t for _, t in found["synced"] if t.strip() and t.strip() != "♪")
            return result("ytmusic", to_lrc(found["synced"]), text or None, False, file_ms)
        if found and found.get("plain") and not plain:
            plain = ("ytmusic", found["plain"], file_ms)
    if plain:
        return result(plain[0], None, plain[1], False, plain[2])
    if record and record.get("instrumental"):
        return result("lrclib", None, None, True, lrclib_ms)
    return result(None, None, None, False, None)


def result(source, synced_lrc, plain, instrumental, duration_ms) -> dict:
    return {
        "source": source,
        "synced_lrc": synced_lrc,
        "plain": plain,
        "instrumental": instrumental,
        "duration_ms": duration_ms,
    }
