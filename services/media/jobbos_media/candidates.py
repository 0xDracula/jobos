from __future__ import annotations

import math
import re
from datetime import date

import httpx

from . import artists as art
from . import config, enrich, matching
from . import musicbrainz as mb

LIMITS = {"ytmusic": 150, "deezer": 80, "lastfm": 80, "listenbrainz": 50}
YTM_PER_SEED = 30
DEEZER_RELATED = 4
DEEZER_TOP = 3
LASTFM_SIMILAR = 15
LASTFM_ARTISTS = 6
LASTFM_ARTIST_TOP = 2
LB_URL = "https://api.listenbrainz.org/1/explore/lb-radio"
LB_SEEDS = 3
RELEASES_PER_ARTIST = 6
RELEASE_TRACKS = 30

lastfm_pacer = mb.Pacer(0.25)
_DASH_RE = re.compile(r"\s+[-–—]\s+")
_CREDIT_RE = re.compile(r"\s+(?:feat\.?|ft\.?|featuring|&|x|and|vs\.?)\s+|,\s*", re.IGNORECASE)


def clean_title(title: str, artists: list[str]) -> str:
    t = title.split(" | ")[0].strip() or title
    parts = _DASH_RE.split(t)
    if len(parts) > 1 and any(matching.similarity(parts[0], a) >= 0.8 for a in artists):
        t = " - ".join(parts[1:])
    return t


def song_key(title: str, artists: list[str]) -> str:
    first = artists[0] if artists else ""
    return f"{matching.skeleton(first)}|{matching.skeleton(clean_title(title, artists))}"


def seconds(length: str | None) -> int | None:
    if not length:
        return None
    try:
        total = 0
        for part in length.split(":"):
            total = total * 60 + int(part)
        return total * 1000
    except ValueError:
        return None


def by_rank(i: int, n: int) -> float:
    return round(1 - i / max(n, 1), 4)


def ytmusic_radio(seeds: list[dict], limit: int, yt=None) -> list[dict]:
    if not seeds:
        return []
    if yt is None:
        from ytmusicapi import YTMusic

        yt = YTMusic()
    per_seed = max(5, math.ceil(limit / len(seeds)))
    out: list[dict] = []
    seen: set[str] = set()
    for seed in seeds:
        vid = seed.get("video_id")
        if not vid:
            continue
        items = [t for t in yt.get_watch_playlist(videoId=vid, radio=True, limit=YTM_PER_SEED).get("tracks") or []
                 if t.get("videoId") and t.get("title") and t["videoId"] != vid]
        taken = 0
        for i, t in enumerate(items):
            if t["videoId"] in seen or taken >= per_seed:
                continue
            seen.add(t["videoId"])
            taken += 1
            thumbs = t.get("thumbnail") or []
            out.append({
                "source": "ytmusic",
                "score": by_rank(i, len(items)),
                "seed_track": seed.get("id"),
                "title": t["title"],
                "artists": [{"name": a["name"], "ytmusic_id": a.get("id")} for a in t.get("artists") or [] if a.get("name")],
                "video_id": t["videoId"],
                "album": (t.get("album") or {}).get("name"),
                "duration_ms": seconds(t.get("length")),
                "artwork_url": enrich.larger_artwork(thumbs[-1]["url"]) if thumbs else None,
            })
    return out[:limit]


def deezer_similar(seeds: list[dict], limit: int) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for seed in seeds:
        related = seed.get("related") or []
        if not related and seed.get("deezer_id"):
            related = [{"name": a["name"], "deezer_id": a["deezer_id"]} for a in art.related(seed["deezer_id"])]
        related = [r for r in related if r.get("deezer_id")][:DEEZER_RELATED]
        for ri, rel in enumerate(related):
            tops = art.deezer_list(f"/artist/{rel['deezer_id']}/top", DEEZER_TOP)
            for ti, t in enumerate(tops):
                if not t.get("id") or str(t["id"]) in seen or not t.get("title"):
                    continue
                seen.add(str(t["id"]))
                album = t.get("album") or {}
                out.append({
                    "source": "deezer",
                    "score": round(0.6 * by_rank(ri, len(related)) + 0.4 * by_rank(ti, len(tops)), 4),
                    "seed_artist": seed.get("name"),
                    "title": t["title"],
                    "artists": [{"name": (t.get("artist") or {}).get("name") or rel["name"]}],
                    "deezer_id": str(t["id"]),
                    "album": album.get("title"),
                    "duration_ms": int(t["duration"]) * 1000 if t.get("duration") else None,
                    "artwork_url": enrich._real(album.get("cover_xl")),
                    "popularity": round(min(1.0, int(t.get("rank") or 0) / 1_000_000), 4),
                })
    out.sort(key=lambda c: -c["score"])
    return out[:limit]


def _lastfm(method: str, **params) -> dict:
    lastfm_pacer.wait()
    return art.lastfm(method, **params) or {}


def _playcount(v) -> float | None:
    try:
        return round(min(1.0, math.log10(int(v) + 1) / 8), 4)
    except (TypeError, ValueError):
        return None


def _items(body: dict, *path: str) -> list[dict]:
    for p in path:
        body = body.get(p) or {}
    return body if isinstance(body, list) else [body] if body else []


def lastfm_similar(tracks: list[dict], artists: list[dict], limit: int) -> list[dict]:
    if not config.LASTFM_API_KEY:
        raise RuntimeError("no LASTFM_API_KEY")
    out: list[dict] = []
    for seed in tracks:
        if not seed.get("artists"):
            continue
        body = _lastfm("track.getsimilar", artist=seed["artists"][0], track=clean_title(seed["title"], seed["artists"]),
                       limit=LASTFM_SIMILAR)
        for t in _items(body, "similartracks", "track"):
            a = (t.get("artist") or {}).get("name")
            if not a or not t.get("name"):
                continue
            out.append({
                "source": "lastfm", "score": round(float(t.get("match") or 0), 4), "seed_track": seed.get("id"),
                "title": t["name"], "artists": [{"name": a}], "mbid": t.get("mbid") or None,
                "duration_ms": int(t["duration"]) * 1000 if str(t.get("duration") or "").isdigit() and int(t["duration"]) else None,
                "popularity": _playcount(t.get("playcount")),
            })
    for seed in artists:
        body = _lastfm("artist.getsimilar", artist=seed["name"], limit=LASTFM_ARTISTS)
        for sim in _items(body, "similarartists", "artist"):
            match = float(sim.get("match") or 0)
            tops = _items(_lastfm("artist.gettoptracks", artist=sim.get("name", ""), limit=LASTFM_ARTIST_TOP), "toptracks", "track")
            for ti, t in enumerate(tops[:LASTFM_ARTIST_TOP]):
                if not t.get("name"):
                    continue
                out.append({
                    "source": "lastfm", "score": round(match * (1 - 0.3 * ti), 4), "seed_artist": seed["name"],
                    "title": t["name"], "artists": [{"name": sim["name"]}], "mbid": t.get("mbid") or None,
                    "popularity": _playcount(t.get("playcount")),
                })
    out.sort(key=lambda c: -c["score"])
    return out[:limit]


def listenbrainz_radio(artists: list[dict], limit: int, http: httpx.Client | None = None) -> list[dict]:
    if not config.LISTENBRAINZ_TOKEN:
        raise RuntimeError("no LISTENBRAINZ_TOKEN")
    http = http or httpx.Client(timeout=90, headers={"User-Agent": mb.user_agent(),
                                                     "Authorization": f"Token {config.LISTENBRAINZ_TOKEN}"})
    seeds = [a for a in artists if a.get("mbid")][:LB_SEEDS] or artists[:LB_SEEDS]
    per_seed = max(5, math.ceil(limit / max(len(seeds), 1)))
    out: list[dict] = []
    failed: list[str] = []
    for seed in seeds:
        r = http.get(LB_URL, params={"prompt": f"artist:({seed.get('mbid') or seed['name']})", "mode": "medium"})
        if r.status_code == 400:
            failed.append(seed["name"])
            continue
        r.raise_for_status()
        items = ((r.json().get("payload") or {}).get("jspf") or {}).get("playlist", {}).get("track") or []
        for i, t in enumerate(items[:per_seed]):
            if not t.get("title") or not t.get("creator"):
                continue
            ident = (t.get("identifier") or [""])[0]
            out.append({
                "source": "listenbrainz", "score": by_rank(i, len(items)), "seed_artist": seed["name"],
                "title": t["title"],
                "artists": [{"name": n} for n in _CREDIT_RE.split(t["creator"]) if n.strip()][:3],
                "mbid": ident.rsplit("/", 1)[-1] if "musicbrainz.org/recording/" in ident else None,
                "album": t.get("album"),
                "duration_ms": int(t["duration"]) if t.get("duration") else None,
            })
    if failed and not out:
        raise RuntimeError(f"LB Radio found none of {', '.join(failed)}")
    return out[:limit]


def fetch_candidates(payload: dict, yt=None) -> dict:
    tracks, artists = payload.get("tracks") or [], payload.get("artists") or []
    limits = {**LIMITS, **(payload.get("limits") or {})}
    library = {}
    for t in payload.get("library") or []:
        library.setdefault(song_key(t["title"], t.get("artists") or []), t["id"])
    sources = {
        "ytmusic": lambda n: ytmusic_radio(tracks, n, yt=yt),
        "deezer": lambda n: deezer_similar(artists, n),
        "lastfm": lambda n: lastfm_similar(tracks, artists, n),
        "listenbrainz": lambda n: listenbrainz_radio(artists, n),
    }
    out: list[dict] = []
    errors: dict[str, str] = {}
    counts: dict[str, int] = {}
    for name, fetch in sources.items():
        if limits.get(name, 0) <= 0:
            continue
        try:
            found = fetch(limits[name])
        except Exception as e:
            errors[name] = f"{type(e).__name__}: {e}"[:300]
            found = []
        counts[name] = len(found)
        out.extend(found)
    for c in out:
        c["key"] = song_key(c["title"], [a["name"] for a in c["artists"]])
        c["track_id"] = library.get(c["key"])
    return {"candidates": out, "errors": errors, "counts": counts}


def fetch_releases(payload: dict) -> dict:
    since = date.fromisoformat(payload["since"])
    out: list[dict] = []
    for a in payload.get("artists") or []:
        if not a.get("deezer_id"):
            continue
        for al in art.deezer_list(f"/artist/{a['deezer_id']}/albums", RELEASES_PER_ARTIST):
            try:
                released = date.fromisoformat(al.get("release_date") or "")
            except ValueError:
                continue
            if released < since or not al.get("id"):
                continue
            tracks = art.deezer_list(f"/album/{al['id']}/tracks", RELEASE_TRACKS)
            out.append({
                "artist_id": a["id"],
                "deezer_id": str(al["id"]),
                "title": al.get("title") or "",
                "kind": al.get("record_type") or "album",
                "release_date": released.isoformat(),
                "artwork_url": enrich._real(al.get("cover_xl")),
                "tracks": [{"title": t["title"], "deezer_id": str(t["id"]),
                            "artists": [(t.get("artist") or {}).get("name") or a["name"]],
                            "duration_ms": int(t["duration"]) * 1000 if t.get("duration") else None}
                           for t in tracks if t.get("title") and t.get("id")],
            })
    return {"releases": out}
