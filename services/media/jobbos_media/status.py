from __future__ import annotations

import importlib.metadata
import time
from datetime import date
from pathlib import Path

import httpx

from . import config

PYPI_TTL_S = 3600
_latest: dict[str, tuple[float, str | None]] = {}


def _version(package: str) -> str | None:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return None


def latest_on_pypi(package: str) -> str | None:
    hit = _latest.get(package)
    if hit and time.monotonic() - hit[0] < PYPI_TTL_S:
        return hit[1]
    try:
        r = httpx.get(f"https://pypi.org/pypi/{package}/json", timeout=10)
        r.raise_for_status()
        version = r.json()["info"]["version"]
    except (httpx.HTTPError, KeyError, ValueError):
        version = None
    _latest[package] = (time.monotonic(), version)
    return version


def release_date(version: str | None) -> str | None:
    try:
        y, m, d = (int(p) for p in (version or "").split(".")[:3])
        return date(y, m, d).isoformat() if y >= 2000 else None
    except ValueError:
        return None


def cookies(path: str | None) -> dict:
    if not path:
        return {"configured": False}
    p = Path(path)
    if not p.is_file():
        return {"configured": True, "exists": False}
    lines = [line for line in p.read_text(errors="replace").splitlines() if line and not line.startswith("#")]
    return {
        "configured": True,
        "exists": True,
        "youtube_cookies": sum(".youtube.com" in line for line in lines),
        "updated_at": int(p.stat().st_mtime),
    }


def status() -> dict:
    ytdlp = _version("yt-dlp")
    latest = latest_on_pypi("yt-dlp")
    return {
        "yt_dlp": {"version": ytdlp, "released": release_date(ytdlp), "latest": latest, "update_available": bool(latest and ytdlp and latest != ytdlp)},
        "ytmusicapi": {"version": _version("ytmusicapi")},
        "cookies": cookies(config.YTDLP_COOKIES),
        "po_token_provider": {"version": _version("bgutil-ytdlp-pot-provider")},
    }
