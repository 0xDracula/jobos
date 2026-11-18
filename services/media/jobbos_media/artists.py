from __future__ import annotations

import html
import re
import time
from functools import lru_cache
from urllib.parse import quote

import httpx

from . import config, enrich, matching
from . import musicbrainz as mb

WIKIPEDIA_URL = "https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}"
WIKIDATA_URL = "https://www.wikidata.org/w/api.php"
LASTFM_URL = "https://ws.audioscrobbler.com/2.0/"
RELATED_LIMIT = 20
TOP_LIMIT = 10
TAG_LIMIT = 12
BIO_CHARS = 600
MUSICIAN_RE = re.compile(
    r"\b(?:band|singer|rapper|musician|songwriter|composer|vocalist|guitarist|pianist|oudist|violinist|drummer|dj|"
    r"duo|trio|orchestra|(?:music(?:al)?|rock|pop|folk|jazz|rap|hip hop|indie|metal|punk|electronic|vocal) "
    r"(?:group|project|collective|ensemble))s?\b"
    r"|مغن|مطرب|فرق[ةه]|موسيق|ملحن|عازف|رابر|منشد",
    re.IGNORECASE,
)
JUNK_TAGS = {"seen live", "favorites", "favourites", "favorite", "favourite", "albums i own", "spotify", "my favorites"}
_SENTENCE_RE = re.compile(r"(?<=[.!?؟])\s+")
_TAG_RE = re.compile(r"<[^>]+>")


@lru_cache(maxsize=1)
def _http() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": mb.user_agent()}, timeout=30, follow_redirects=True)


wiki_pacer = mb.Pacer(1.0)
WIKI_TRIES = 4


def wiki_get(url: str, params: dict | None = None) -> httpx.Response:
    for _ in range(WIKI_TRIES):
        wiki_pacer.wait()
        r = _http().get(url, params=params)
        if r.status_code != 429:
            return r
        retry = r.headers.get("Retry-After", "")
        time.sleep(min(float(retry), 30.0) if retry.isdigit() else 5.0)
    return r



def deezer_artist(deezer_id: str) -> dict | None:
    body = enrich._deezer(f"/artist/{deezer_id}")
    return None if body.get("error") else body


def deezer_list(path: str, limit: int) -> list[dict]:
    body = enrich._deezer(path, {"limit": limit})
    return [] if body.get("error") else body.get("data") or []


def same_artist(name: str, other: str) -> bool:
    return matching.similarity(name, other or "") >= 0.8


def find_deezer_artist(name: str, isrcs: list[str], titles: list[str], by_isrc=None, search=None) -> str | None:
    by_isrc, search = by_isrc or enrich.deezer_track, search or enrich.deezer_search
    for isrc in isrcs[:2]:
        track = by_isrc(isrc) or {}
        for a in [track.get("artist") or {}, *(track.get("contributors") or [])]:
            if a.get("id") and same_artist(name, a.get("name")):
                return str(a["id"])
    for title in titles[:2]:
        for t in search(name, title):
            a = t.get("artist") or {}
            if a.get("id") and same_artist(name, a.get("name")):
                return str(a["id"])
    return None


def related(deezer_id: str) -> list[dict]:
    return [
        {"name": a["name"], "deezer_id": str(a["id"]), "image_url": enrich._real(a.get("picture_big"))}
        for a in deezer_list(f"/artist/{deezer_id}/related", RELATED_LIMIT)
        if a.get("name") and a.get("id")
    ][:RELATED_LIMIT]


def top_tracks(deezer_id: str) -> list[dict]:
    return [
        {
            "title": t["title"],
            "deezer_id": str(t["id"]),
            "album": (t.get("album") or {}).get("title") or None,
            "duration_ms": int(t["duration"]) * 1000 if t.get("duration") else None,
            "artwork_url": enrich._real((t.get("album") or {}).get("cover_xl")),
        }
        for t in deezer_list(f"/artist/{deezer_id}/top", TOP_LIMIT)
        if t.get("title") and t.get("id")
    ][:TOP_LIMIT]



def find_mbid(name: str, isrcs: list[str], titles: list[str]) -> str | None:
    for isrc in isrcs[:2]:
        for rec in mb.recordings_by_isrc(isrc):
            for credit in rec.get("artist-credit") or []:
                a = credit.get("artist") or {}
                if a.get("id") and (same_artist(name, credit.get("name")) or same_artist(name, a.get("name"))):
                    return a["id"]
    if not titles:
        return None
    try:
        found = mb.search_artists(name)
    except mb.Unavailable:
        return None
    if not found or found[0].get("score", 0) < 95:
        return None
    if len(found) > 1 and found[1].get("score", 0) >= found[0]["score"]:
        return None
    best = found[0]
    names = [best.get("name") or ""] + [a.get("name") or "" for a in best.get("aliases") or []]
    if not any(matching.similarity(name, n) >= 0.9 for n in names):
        return None
    recorded = [r.get("title") or "" for r in mb.artist_recordings(best["id"])]
    if any(matching.title_similarity(t, r) >= 0.8 for t in titles for r in recorded):
        return best["id"]
    return None



def is_arabic(text: str) -> bool:
    return bool(matching.ARABIC_RE.search(text))


def short(text: str, limit: int = BIO_CHARS) -> str:
    out = ""
    for sentence in _SENTENCE_RE.split(" ".join(text.split())):
        if out and len(out) + len(sentence) + 1 > limit:
            break
        out = f"{out} {sentence}".strip()
    return out


def wikipedia_summary(lang: str, title: str) -> dict | None:
    r = wiki_get(WIKIPEDIA_URL.format(lang=lang, title=quote(title.replace(" ", "_"), safe="")))
    if r.status_code == 404:
        return None
    r.raise_for_status()
    d = r.json()
    url = ((d.get("content_urls") or {}).get("desktop") or {}).get("page")
    if d.get("type") != "standard" or not d.get("extract") or not url:
        return None
    return {"text": d["extract"], "description": d.get("description") or "", "url": url}


def wikidata_titles(qid: str) -> dict[str, str]:
    r = wiki_get(WIKIDATA_URL, params={"action": "wbgetentities", "ids": qid, "props": "sitelinks",
                                          "sitefilter": "enwiki|arwiki", "format": "json"})
    r.raise_for_status()
    links = ((r.json().get("entities") or {}).get(qid) or {}).get("sitelinks") or {}
    return {site[:2]: link["title"] for site, link in links.items() if link.get("title")}


def about_a_musician(summary: dict) -> bool:
    first = _SENTENCE_RE.split(summary["text"], maxsplit=1)[0]
    return bool(MUSICIAN_RE.search(summary["description"]) or MUSICIAN_RE.search(first))


def wikipedia_bio(name: str, qid: str | None, summary=None, titles=None) -> dict | None:
    summary, titles = summary or wikipedia_summary, titles or wikidata_titles
    langs = ["ar", "en"] if is_arabic(name) else ["en", "ar"]
    if qid:
        linked = titles(qid)
        for lang in langs:
            if lang in linked and (s := summary(lang, linked[lang])):
                return {"bio": short(s["text"]), "url": s["url"]}
    s = summary(langs[0], name)
    if s and about_a_musician(s):
        return {"bio": short(s["text"]), "url": s["url"]}
    return None



class LastfmUnavailable(RuntimeError):
    pass


LASTFM_KEY_ERRORS = {4, 9, 10, 26}
LASTFM_NOT_FOUND = 6
LASTFM_REFUSED_PAUSE = 3600.0
_lastfm_refused_until = 0.0


def lastfm(method: str, **params) -> dict | None:
    global _lastfm_refused_until
    if not config.LASTFM_API_KEY:
        return None
    if time.monotonic() < _lastfm_refused_until:
        raise LastfmUnavailable("Last.fm refused the API key")
    try:
        r = _http().get(LASTFM_URL, params={"method": method, "api_key": config.LASTFM_API_KEY, "format": "json",
                                            "autocorrect": 1, **params})
    except httpx.HTTPError as e:
        raise LastfmUnavailable(f"Last.fm unreachable: {e}") from e
    try:
        body = r.json()
    except ValueError:
        body = None
    code = body.get("error") if isinstance(body, dict) else None
    if r.status_code in (401, 403) or code in LASTFM_KEY_ERRORS:
        _lastfm_refused_until = time.monotonic() + LASTFM_REFUSED_PAUSE
        raise LastfmUnavailable("Last.fm refused the API key")
    if r.status_code == 404 or code == LASTFM_NOT_FOUND:
        return None
    if r.status_code >= 400 or code is not None or not isinstance(body, dict):
        raise LastfmUnavailable(f"Last.fm error {code if code is not None else r.status_code}")
    return body


def lastfm_optional(method: str, **params) -> dict | None:
    try:
        return lastfm(method, **params)
    except LastfmUnavailable:
        return None


def lastfm_tags(body: dict | None) -> list[tuple[str, int]]:
    items = ((body or {}).get("toptags") or {}).get("tag") or []
    out = []
    for t in items if isinstance(items, list) else [items]:
        name, count = (t.get("name") or "").strip().lower(), int(t.get("count") or 0)
        if name and count >= 10 and name not in JUNK_TAGS:
            out.append((name, count))
    return out


def lastfm_bio(name: str) -> dict | None:
    a = ((lastfm_optional("artist.getinfo", artist=name) or {}).get("artist")) or {}
    summary = (a.get("bio") or {}).get("summary") or ""
    text = html.unescape(_TAG_RE.sub("", summary.split("<a href")[0])).strip()
    return {"bio": short(text), "url": a.get("url")} if text and a.get("url") else None


def weighted(tags: list[tuple[str, int]], source: str) -> list[dict]:
    if not tags:
        return []
    top = max(count for _, count in tags)
    return [{"name": name[:60], "source": source, "weight": round(count / top, 3)} for name, count in tags[:TAG_LIMIT]]



def enrich_artist(payload: dict, fetch=None) -> dict:
    fetch = fetch or enrich.fetch_image
    name = payload["name"]
    isrcs, titles = payload.get("isrcs") or [], payload.get("titles") or []
    out = {"deezer_id": None, "mbid": None, "image": None, "bio": None, "bio_source": None, "bio_url": None,
           "tags": [], "related": [], "top_tracks": []}

    deezer_id = payload.get("deezer_id") or find_deezer_artist(name, isrcs, titles)
    if deezer_id:
        out["deezer_id"] = str(deezer_id)
        out["related"] = related(deezer_id)
        out["top_tracks"] = top_tracks(deezer_id)
        if payload.get("need_image"):
            picture = enrich._real((deezer_artist(deezer_id) or {}).get("picture_xl"))
            if picture:
                out["image"] = enrich.store_image(fetch(picture), "image", with_palette=False)

    mbid = payload.get("mbid") or find_mbid(name, isrcs, titles)
    qid = None
    if mbid:
        entity = mb.artist(mbid)
        if entity:
            out["mbid"] = mbid
            out["tags"] += weighted(mb.tags(entity), "musicbrainz")
            qid = mb.wikidata_id(entity)

    bio = wikipedia_bio(name, qid)
    if bio:
        out.update(bio=bio["bio"], bio_source="wikipedia", bio_url=bio["url"])
    elif bio := lastfm_bio(name):
        out.update(bio=bio["bio"], bio_source="lastfm", bio_url=bio["url"])
    out["tags"] += weighted(lastfm_tags(lastfm_optional("artist.gettoptags", artist=name)), "lastfm")
    return out


def fetch_track_tags(payload: dict) -> dict:
    title, artists = payload["title"], payload.get("artists") or []
    out = {"recording_mbid": None, "tags": []}
    if payload.get("isrc"):
        for rec in mb.recordings_by_isrc(payload["isrc"]):
            if matching.title_similarity(title, rec.get("title") or "") >= 0.6:
                out["recording_mbid"] = rec["id"]
                out["tags"] += weighted(mb.tags(mb.recording(rec["id"]) or {}), "musicbrainz")
                break
    if artists:
        out["tags"] += weighted(lastfm_tags(lastfm_optional("track.gettoptags", artist=artists[0], track=title)), "lastfm")
    return out
