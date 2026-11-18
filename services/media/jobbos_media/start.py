from __future__ import annotations

import re

from .search import _client

COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
RELATED_LIMIT = 12
SONGS_LIMIT = 3


def _image(thumbnails: list[dict] | None) -> str | None:
    if not thumbnails:
        return None
    url = max(thumbnails, key=lambda t: t.get("width") or 0).get("url") or thumbnails[-1].get("url")
    return re.sub(r"=w\d+-h\d+", "=w300-h300", url) if url else None


def _artist(item: dict, name_key: str = "title") -> dict | None:
    browse_id, name = item.get("browseId"), item.get(name_key) or item.get("artist") or item.get("title")
    if not browse_id or not name:
        return None
    return {"id": browse_id, "name": name, "image": _image(item.get("thumbnails"))}


def chart_artists(country: str, yt=None) -> list[dict]:
    country = country.upper() if country and COUNTRY_RE.match(country.upper()) else "ZZ"
    charts = (yt or _client()).get_charts(country=country)
    items = charts.get("artists")
    if isinstance(items, dict):
        items = items.get("items")
    return [a for a in (_artist(i) for i in items or []) if a]


def artist(browse_id: str, yt=None) -> dict:
    a = (yt or _client()).get_artist(browse_id)
    related = [r for r in (_artist(i) for i in ((a.get("related") or {}).get("results") or [])) if r][:RELATED_LIMIT]
    songs = []
    for s in ((a.get("songs") or {}).get("results") or [])[:SONGS_LIMIT]:
        if s.get("videoId") and s.get("title"):
            songs.append({"video_id": s["videoId"], "title": s["title"],
                          "artists": [x["name"] for x in s.get("artists") or [] if x.get("name")] or [a.get("name") or ""]})
    return {"id": browse_id, "name": a.get("name"), "related": related, "songs": songs}


def search_artists(q: str, limit: int = 12, yt=None) -> list[dict]:
    found = (yt or _client()).search(q, filter="artists", limit=limit)
    return [a for a in (_artist(i, "artist") for i in found or []) if a][:limit]
