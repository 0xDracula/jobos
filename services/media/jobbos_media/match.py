from __future__ import annotations

import re
from collections.abc import Callable

from . import matching, search

Search = Callable[[str, int], list[dict]]

MAX_CANDIDATES = 5
_FEAT_RE = re.compile(r"\s*[(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]", re.IGNORECASE)
_EDITION_RE = re.compile(
    r"\s+-\s+(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|radio edit|single version|mono|stereo)\s*$",
    re.IGNORECASE,
)


def query_for(title: str, artists: list[str]) -> str:
    t = _EDITION_RE.sub("", _FEAT_RE.sub("", title)).strip()
    return " ".join([t, *artists[:2]]).strip()


def is_official(candidate: dict, artists: list[str]) -> bool:
    if candidate.get("official"):
        return True
    for a in candidate.get("artists") or []:
        name = a["name"]
        if name.endswith(" - Topic") or any(matching.similarity(name, artist) >= 0.9 for artist in artists):
            return True
    return False


def rank(source: matching.Recording, candidates: list[dict]) -> list[dict]:
    scored = []
    for c in candidates:
        recording = matching.Recording(
            title=c["title"],
            artists=[a["name"] for a in c.get("artists") or []],
            duration_ms=c.get("duration_ms"),
            official=bool(c.get("official")),
        )
        scored.append({**c, "score": matching.score(source, recording)})
    return sorted(scored, key=lambda c: c["score"], reverse=True)


def match_track(payload: dict, songs: Search = search.search_songs, videos: Search = search.search_videos) -> dict:
    title = payload["title"]
    artists = payload.get("artists") or []
    source = matching.Recording(
        title=title, artists=artists, duration_ms=payload.get("duration_ms"), isrc=payload.get("isrc")
    )
    query = query_for(title, artists)
    found = {c["external_id"]: c for c in songs(query, 10)}
    ranked = rank(source, list(found.values()))
    if not ranked or ranked[0]["score"] < matching.ACCEPT_AT:
        for c in videos(query, 10):
            found.setdefault(c["external_id"], {**c, "official": is_official(c, artists)})
        ranked = rank(source, list(found.values()))
    top = ranked[:MAX_CANDIDATES]
    verdict = matching.classify(top[0]["score"]) if top else "unmatched"
    return {"verdict": verdict, "query": query, "candidates": top}
