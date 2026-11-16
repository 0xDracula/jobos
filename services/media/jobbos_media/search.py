from __future__ import annotations

import re
from functools import lru_cache

from ytmusicapi import YTMusic


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
            }
        )
    return out[:limit]
