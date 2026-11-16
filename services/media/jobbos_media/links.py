from __future__ import annotations

import json
import re
from functools import lru_cache
from urllib.parse import parse_qs, urlparse

import httpx
import yt_dlp

from .search import _client as ytmusic_client
from .search import large_artwork

USER_AGENT = "Jobbos/0.1 (private music player)"
SPOTIFY_RE = re.compile(r"^https?://open\.spotify\.com/(?:intl-[a-z-]+/)?(track|album|playlist)/([0-9A-Za-z]{22})(?:[/?#]|$)")
_NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)
_URI_ID_RE = re.compile(r"^spotify:(?:track|artist):([0-9A-Za-z]{22})$")
EMBED_LIMIT = 100
MAX_PLAYLIST = 1000
_ARTIST_SEPARATOR_RE = re.compile(r"[,，]")


class LinkError(Exception):
    pass


@lru_cache(maxsize=1)
def _http() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=20, follow_redirects=True)


def resolve_link(url: str) -> dict:
    url = url.strip()
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or not host:
        raise LinkError("Not a link")
    m = SPOTIFY_RE.match(url)
    if m:
        return spotify_link(m.group(1), m.group(2))
    if host.endswith("spotify.com"):
        raise LinkError(f"Unsupported link: {host}")
    list_id = youtube_playlist_id(url)
    if list_id:
        return youtube_playlist(list_id, host)
    if host.endswith("soundcloud.com") and "/sets/" in parsed.path:
        return soundcloud_set(url)
    return ytdlp_link(url, host)


def youtube_playlist_id(url: str) -> str | None:
    p = urlparse(url)
    host = (p.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    if host not in ("youtube.com", "music.youtube.com"):
        return None
    q = parse_qs(p.query)
    if "list" in q and (p.path == "/playlist" or "v" not in q):
        return q["list"][0]
    return None


def youtube_playlist(list_id: str, host: str) -> dict:
    provider = "ytmusic" if host == "music.youtube.com" else "youtube"
    try:
        playlist = ytmusic_client().get_playlist(list_id, limit=MAX_PLAYLIST)
    except Exception as e:
        raise LinkError("Playlist not found or private") from e
    recordings = []
    for t in playlist.get("tracks") or []:
        if not t.get("videoId") or t.get("isAvailable") is False:
            continue
        thumbnails = t.get("thumbnails") or []
        album = t.get("album")
        recordings.append(
            {
                "provider": provider,
                "external_id": t["videoId"],
                "title": t.get("title") or "",
                "artists": [{"name": a["name"], "id": a.get("id")} for a in t.get("artists") or [] if a.get("name")],
                "album": {"name": album["name"], "id": album.get("id")} if album and album.get("name") else None,
                "duration_ms": int(t["duration_seconds"]) * 1000 if t.get("duration_seconds") else None,
                "thumbnail": large_artwork(thumbnails[-1]["url"]) if thumbnails else None,
                "explicit": bool(t.get("isExplicit")),
            }
        )
    return {
        "kind": "playlist",
        "provider": provider,
        "id": list_id,
        "name": playlist.get("title") or "YouTube playlist",
        "recordings": recordings,
        "truncated": (playlist.get("trackCount") or 0) > MAX_PLAYLIST,
    }


def soundcloud_set(url: str) -> dict:
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
        info = ydl.extract_info(url, download=False, process=False)
        entries = list(info.get("entries") or [])[:MAX_PLAYLIST]
        full = [e if e.get("title") else ydl.extract_info(e["url"], download=False, process=False) for e in entries if e.get("url")]
    recordings = [
        {
            "provider": "soundcloud",
            "external_id": e.get("webpage_url") or e["url"],
            "title": e.get("title") or "",
            "artists": [{"name": e["uploader"], "id": None}] if e.get("uploader") else [],
            "album": None,
            "duration_ms": int(e["duration"] * 1000) if e.get("duration") else None,
            "thumbnail": e.get("thumbnail"),
            "explicit": False,
        }
        for e in full
        if e.get("title")
    ]
    return {
        "kind": "playlist",
        "provider": "soundcloud",
        "id": str(info.get("id") or url),
        "name": info.get("title") or "SoundCloud playlist",
        "recordings": recordings,
        "truncated": False,
    }


def spotify_embed(kind: str, spotify_id: str) -> dict:
    r = _http().get(f"https://open.spotify.com/embed/{kind}/{spotify_id}")
    if r.status_code == 404:
        raise LinkError("Spotify page not found")
    r.raise_for_status()
    m = _NEXT_DATA_RE.search(r.text)
    if not m:
        raise LinkError("Spotify page without track data")
    entity = json.loads(m.group(1)).get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity")
    if not entity:
        raise LinkError("Spotify page without track data")
    return entity


def _uri_id(uri: str | None) -> str | None:
    m = _URI_ID_RE.match(uri or "")
    return m.group(1) if m else None


def _largest_image(entity: dict) -> str | None:
    images = (entity.get("visualIdentity") or {}).get("image") or []
    return max(images, key=lambda i: i.get("maxWidth") or 0)["url"] if images else None


def spotify_tracks(kind: str, entity: dict) -> list[dict]:
    if kind == "track":
        return [
            {
                "spotify_id": entity["id"],
                "title": entity.get("name") or entity.get("title") or "",
                "artists": [{"name": a["name"], "spotify_id": _uri_id(a.get("uri"))} for a in entity.get("artists") or []],
                "album": "",
                "artwork_url": _largest_image(entity),
                "duration_ms": entity.get("duration"),
                "explicit": bool(entity.get("isExplicit")),
            }
        ]
    album = entity.get("name") if kind == "album" else ""
    artwork = _largest_image(entity) if kind == "album" else None
    out = []
    for t in entity.get("trackList") or []:
        track_id = _uri_id(t.get("uri"))
        if not track_id:
            continue
        out.append(
            {
                "spotify_id": track_id,
                "title": t.get("title") or "",
                "artists": [{"name": n.strip(), "spotify_id": None} for n in (t.get("subtitle") or "").split(", ") if n.strip()],
                "album": album,
                "album_spotify_id": entity.get("id") if kind == "album" else "",
                "artwork_url": artwork,
                "duration_ms": t.get("duration"),
                "explicit": bool(t.get("isExplicit")),
            }
        )
    return out


def spotify_link(kind: str, spotify_id: str) -> dict:
    entity = spotify_embed(kind, spotify_id)
    tracks = spotify_tracks(kind, entity)
    if not tracks:
        raise LinkError("No tracks on this Spotify page")
    return {
        "kind": "spotify",
        "type": kind,
        "id": spotify_id,
        "name": entity.get("name") or "",
        "tracks": tracks,
        "truncated": kind == "playlist" and len(tracks) >= EMBED_LIMIT,
    }


def recording_from_info(info: dict, url: str, host: str) -> dict:
    key = info.get("extractor_key") or ""
    if key == "Youtube":
        provider = "ytmusic" if host == "music.youtube.com" else "youtube"
        external_id = info["id"]
    else:
        provider = "soundcloud" if key == "Soundcloud" else "other"
        external_id = info.get("webpage_url") or url
    artist = info.get("artist") or info.get("uploader") or info.get("channel")
    return {
        "provider": provider,
        "external_id": external_id,
        "title": info.get("track") or info.get("title") or "",
        "artists": [{"name": a.strip(), "id": None} for a in _ARTIST_SEPARATOR_RE.split(artist) if a.strip()] if artist else [],
        "album": {"name": info["album"], "id": None} if info.get("album") else None,
        "duration_ms": int(info["duration"] * 1000) if info.get("duration") else None,
        "thumbnail": info.get("thumbnail"),
        "explicit": False,
    }


def ytdlp_link(url: str, host: str) -> dict:
    opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "extract_flat": "in_playlist"}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        if "Unsupported URL" in str(e) or "[generic]" in str(e):
            raise LinkError(f"Unsupported link: {host}") from e
        raise
    if info.get("_type") in ("playlist", "multi_video"):
        raise LinkError("Playlist links from this site aren't supported yet")
    return {"kind": "recording", "recording": recording_from_info(info, url, host)}
