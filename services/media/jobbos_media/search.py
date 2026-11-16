from __future__ import annotations

import functools
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import yt_dlp
from ytmusicapi import YTMusic

from . import matching

log = logging.getLogger("jobbos.search")

ISRC_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$")


def clean_isrc(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    isrc = value.replace("-", "").replace(" ", "").upper()
    return isrc if ISRC_RE.match(isrc) else None


def with_isrc(extract):
    @functools.wraps(extract)
    def wrapper(self, info, *args, **kwargs):
        out = extract(self, info, *args, **kwargs)
        if isinstance(out, dict) and isinstance(info, dict):
            isrc = clean_isrc((info.get("publisher_metadata") or {}).get("isrc"))
            if isrc:
                out["isrc"] = isrc
        return out

    wrapper.keeps_isrc = True
    return wrapper


def keep_soundcloud_isrc() -> bool:
    try:
        from yt_dlp.extractor import soundcloud

        base = soundcloud.SoundcloudBaseIE
        if not getattr(base._extract_info_dict, "keeps_isrc", False):
            base._extract_info_dict = with_isrc(base._extract_info_dict)
        return True
    except (ImportError, AttributeError) as e:
        log.warning("SoundCloud ISRCs unavailable: %s", e)
        return False


keep_soundcloud_isrc()


_SIZE_RE = re.compile(r"=w\d+-h\d+")


def large_artwork(url: str | None) -> str | None:
    return _SIZE_RE.sub("=w544-h544", url, count=1) if url else url


@lru_cache(maxsize=1)
def _client() -> YTMusic:
    return YTMusic()


def search_songs(query: str, limit: int = 20) -> list[dict]:
    results = _client().search(query, filter="songs", limit=limit)
    out: list[dict] = []
    for r in results:
        video_id = r.get("videoId")
        if not video_id:
            continue
        thumbnails = r.get("thumbnails") or []
        album = r.get("album")
        out.append(
            {
                "provider": "ytmusic",
                "external_id": video_id,
                "title": r.get("title") or "",
                "artists": [
                    {"name": a["name"], "id": a.get("id")} for a in (r.get("artists") or []) if a.get("name")
                ],
                "album": {"name": album.get("name"), "id": album.get("id")} if album else None,
                "duration_ms": int(r["duration_seconds"]) * 1000 if r.get("duration_seconds") else None,
                "explicit": bool(r.get("isExplicit")),
                "thumbnail": large_artwork(thumbnails[-1]["url"]) if thumbnails else None,
                "official": True,
                "isrc": None,
            }
        )
    return out[:limit]


def search_videos(query: str, limit: int = 10) -> list[dict]:
    results = _client().search(query, filter="videos", limit=limit)
    out: list[dict] = []
    for r in results:
        video_id = r.get("videoId")
        if not video_id:
            continue
        thumbnails = r.get("thumbnails") or []
        out.append(
            {
                "provider": "youtube",
                "external_id": video_id,
                "title": r.get("title") or "",
                "artists": [
                    {"name": a["name"], "id": a.get("id")} for a in (r.get("artists") or []) if a.get("name")
                ],
                "album": None,
                "duration_ms": int(r["duration_seconds"]) * 1000 if r.get("duration_seconds") else None,
                "explicit": False,
                "thumbnail": thumbnails[-1]["url"] if thumbnails else None,
                "official": False,
                "isrc": None,
            }
        )
    return out[:limit]


SOURCE_DEADLINE_S = 6.0
CACHE_TTL_S = 600
CACHE_SIZE = 256
PREVIEW_MAX_MS = 30_000
_pool = ThreadPoolExecutor(max_workers=6)
_cache: dict[str, tuple[float, list[dict]]] = {}


def _ytdlp_search(query: str) -> list[dict]:
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "extract_flat": "in_playlist"}) as ydl:
        return ydl.extract_info(query, download=False).get("entries") or []


def _flat_result(entry: dict, provider: str) -> dict:
    thumbnails = entry.get("thumbnails") or []
    thumb = thumbnails[-1]["url"] if thumbnails else None
    if provider == "youtube" and not thumb:
        thumb = f"https://i.ytimg.com/vi/{entry['id']}/hqdefault.jpg"
    return {
        "provider": provider,
        "external_id": entry["id"] if provider == "youtube" else entry["url"],
        "title": entry.get("title") or "",
        "artists": [{"name": entry["uploader"], "id": None}] if entry.get("uploader") else [],
        "album": None,
        "duration_ms": int(entry["duration"] * 1000) if entry.get("duration") else None,
        "explicit": False,
        "thumbnail": thumb,
        "official": False,
        "isrc": clean_isrc(entry.get("isrc")),
    }


def search_youtube(query: str, limit: int = 10) -> list[dict]:
    return [_flat_result(e, "youtube") for e in _ytdlp_search(f"ytsearch{limit}:{query}") if e.get("id")]


def search_soundcloud(query: str, limit: int = 10) -> list[dict]:
    results = [_flat_result(e, "soundcloud") for e in _ytdlp_search(f"scsearch{limit}:{query}") if e.get("url")]
    return [r for r in results if not r["duration_ms"] or r["duration_ms"] > PREVIEW_MAX_MS]


def same_recording(a: dict, b: dict) -> bool:
    if a.get("isrc") and a.get("isrc") == b.get("isrc"):
        return True
    if a["duration_ms"] and b["duration_ms"] and abs(a["duration_ms"] - b["duration_ms"]) > 3000:
        return False
    names = lambda r: [x["name"] for x in r["artists"]]
    return (
        matching.title_similarity(a["title"], b["title"]) >= 0.9
        and matching.artist_similarity(names(a), names(b), b["title"]) >= 0.8
    )


def dedupe(results: list[dict]) -> list[dict]:
    kept: list[dict] = []
    for r in results:
        if not any(same_recording(k, r) for k in kept):
            kept.append(r)
    return kept


SOURCES = {"ytmusic": search_songs, "youtube": search_youtube, "soundcloud": search_soundcloud}
PER_SOURCE = {"ytmusic": 8, "youtube": 6, "soundcloud": 4}


def search_all(query: str, limit: int = 20, sources: list[str] | None = None) -> list[dict]:
    names = [n for n in SOURCES if sources is None or n in sources]
    key = f"{limit}:{','.join(names)}:{' '.join(query.lower().split())}"
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_TTL_S:
        return hit[1]
    futures = {name: _pool.submit(SOURCES[name], query, 10) for name in names}
    deadline = time.monotonic() + SOURCE_DEADLINE_S
    merged: list[dict] = []
    for name, future in futures.items():
        try:
            merged += future.result(timeout=max(0.0, deadline - time.monotonic()))[: PER_SOURCE[name]]
        except Exception as e:
            log.warning("search %s: %s", name, e or type(e).__name__)
    results = dedupe(merged)[:limit]
    if len(_cache) >= CACHE_SIZE:
        _cache.pop(next(iter(_cache)))
    _cache[key] = (time.monotonic(), results)
    return results
