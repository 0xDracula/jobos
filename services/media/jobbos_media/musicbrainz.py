from __future__ import annotations

import threading
import time
from functools import lru_cache

import httpx

from . import __version__, config

BASE_URL = "https://musicbrainz.org/ws/2"
INTERVAL_S = 1.0
TRIES = 4


class Unavailable(Exception):
    pass


class Pacer:
    def __init__(self, interval: float, clock=time.monotonic, sleep=time.sleep):
        self.interval, self.clock, self.sleep = interval, clock, sleep
        self.lock = threading.Lock()
        self.next_at = float("-inf")

    def wait(self) -> None:
        with self.lock:
            now = self.clock()
            if now < self.next_at:
                self.sleep(self.next_at - now)
                now = self.next_at
            self.next_at = now + self.interval


pacer = Pacer(INTERVAL_S)


def user_agent(contact: str | None = None) -> str:
    contact = config.MUSICBRAINZ_CONTACT if contact is None else contact
    return f"Jobbos/{__version__} ( {contact} )" if contact else f"Jobbos/{__version__}"


@lru_cache(maxsize=1)
def _http() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, headers={"User-Agent": user_agent(), "Accept": "application/json"}, timeout=30)


def get(path: str, params: dict | None = None) -> dict | None:
    for attempt in range(TRIES):
        pacer.wait()
        r = _http().get(path, params={**(params or {}), "fmt": "json"})
        if r.status_code in (400, 404):
            return None
        if r.status_code in (429, 503):
            retry = r.headers.get("Retry-After", "")
            time.sleep(min(float(retry), 30.0) if retry.isdigit() else 2.0 * 2**attempt)
            continue
        r.raise_for_status()
        return r.json()
    raise Unavailable(f"MusicBrainz {path}: {r.status_code}")


def recordings_by_isrc(isrc: str) -> list[dict]:
    return (get(f"/isrc/{isrc}", {"inc": "artist-credits"}) or {}).get("recordings") or []


def recording(mbid: str) -> dict | None:
    return get(f"/recording/{mbid}", {"inc": "genres+tags"})


def artist(mbid: str) -> dict | None:
    return get(f"/artist/{mbid}", {"inc": "genres+tags+url-rels+aliases"})


def artist_recordings(mbid: str, limit: int = 100) -> list[dict]:
    return (get("/recording", {"artist": mbid, "limit": limit}) or {}).get("recordings") or []


def _quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def search_artists(name: str, limit: int = 5) -> list[dict]:
    q = f"artist:{_quote(name)} OR alias:{_quote(name)}"
    return (get("/artist", {"query": q, "limit": limit}) or {}).get("artists") or []


def tags(entity: dict) -> list[tuple[str, int]]:
    votes: dict[str, int] = {}
    for item in (entity.get("genres") or []) + (entity.get("tags") or []):
        name, count = (item.get("name") or "").strip().lower(), item.get("count") or 0
        if name and count > 0:
            votes[name] = max(votes.get(name, 0), count)
    return sorted(votes.items(), key=lambda kv: -kv[1])


def wikidata_id(entity: dict) -> str | None:
    for rel in entity.get("relations") or []:
        url = (rel.get("url") or {}).get("resource") or ""
        if rel.get("type") == "wikidata" and "/wiki/Q" in url:
            return url.rsplit("/", 1)[-1]
    return None
