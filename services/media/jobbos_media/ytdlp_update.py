from __future__ import annotations

import hashlib
import importlib.metadata
import io
import json
import logging
import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import httpx

from . import config

log = logging.getLogger("jobbos.ytdlp")

PYPI_URL = "https://pypi.org/pypi/yt-dlp/json"
MAX_WHEEL_BYTES = 50 << 20
KEEP_VERSIONS = 2

_bundled: str | None = None
_started: Path | None = None
_active: Path | None = None


def directory() -> Path:
    return Path(os.environ.get("YTDLP_DIR") or config.MEDIA_ROOT.parent / "ytdlp").resolve()


def version_key(version: str | None) -> tuple[int, ...]:
    try:
        return tuple(int(p) for p in (version or "").split("."))
    except ValueError:
        return ()


def newer(a: str | None, b: str | None) -> bool:
    return version_key(a) > version_key(b)


def _current_release() -> Path | None:
    link = directory() / "current"
    try:
        target = link.resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    return target if (target / "yt_dlp" / "__init__.py").is_file() else None


def activate() -> Path | None:
    global _bundled, _started, _active
    if _bundled is None:
        try:
            _bundled = importlib.metadata.version("yt-dlp")
        except importlib.metadata.PackageNotFoundError:
            _bundled = ""
    _started = _current_release()
    if _active or _started is None or "yt_dlp" in sys.modules or not newer(_started.name, _bundled):
        return _active
    sys.path.insert(0, str(_started))
    _active = _started
    return _active


def changed() -> bool:
    return _current_release() != _started


def bundled_version() -> str | None:
    return _bundled or None


def running_version() -> str | None:
    from yt_dlp.version import __version__

    return __version__


def installed() -> dict | None:
    release = _current_release()
    if release is None:
        return None
    state = _read_state()
    at = state.get("installed_at") if state.get("version") == release.name else None
    return {"version": release.name, "installed_at": at or int(release.stat().st_mtime)}


def active_version() -> str | None:
    release = _current_release()
    if release and newer(release.name, _bundled):
        return release.name
    return _bundled or None


def _read_state() -> dict:
    try:
        return json.loads((directory() / "state.json").read_text())
    except (OSError, ValueError):
        return {}


def latest_release(http: httpx.Client) -> dict:
    r = http.get(PYPI_URL)
    r.raise_for_status()
    data = r.json()
    version = data["info"]["version"]
    for f in data.get("urls") or []:
        if f.get("packagetype") == "bdist_wheel" and f["filename"].endswith("-py3-none-any.whl") and not f.get("yanked"):
            return {"version": version, "url": f["url"], "sha256": f["digests"]["sha256"]}
    raise RuntimeError(f"yt-dlp {version} has no universal wheel on PyPI")


def download_wheel(http: httpx.Client, url: str, sha256: str) -> bytes:
    data = bytearray()
    with http.stream("GET", url) as r:
        r.raise_for_status()
        for chunk in r.iter_bytes():
            data += chunk
            if len(data) > MAX_WHEEL_BYTES:
                raise RuntimeError("yt-dlp wheel too large")
    if hashlib.sha256(data).hexdigest() != sha256:
        raise RuntimeError("yt-dlp wheel does not match its SHA-256")
    return bytes(data)


def unpack(wheel: bytes, target: Path) -> None:
    tmp = target.with_name(f".{target.name}-{os.getpid()}")
    shutil.rmtree(tmp, ignore_errors=True)
    with zipfile.ZipFile(io.BytesIO(wheel)) as z:
        for name in z.namelist():
            if name.startswith("/") or ".." in Path(name).parts:
                raise RuntimeError(f"unsafe path in wheel: {name}")
        z.extractall(tmp)
    if not (tmp / "yt_dlp" / "__init__.py").is_file():
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError("wheel without yt_dlp")
    os.replace(tmp, target)


def check(release: Path, version: str) -> None:
    code = (
        "import sys; sys.path.insert(0, sys.argv[1]); import yt_dlp, yt_dlp.version;"
        "assert yt_dlp.__file__.startswith(sys.argv[1]), yt_dlp.__file__;"
        "assert yt_dlp.version.__version__ == sys.argv[2], yt_dlp.version.__version__;"
        "assert len(list(yt_dlp.extractor.gen_extractor_classes())) > 100"
    )
    proc = subprocess.run([sys.executable, "-I", "-c", code, str(release), version], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp {version} failed its import check: {proc.stderr.strip()[-500:]}")


def switch(release: Path, previous: str | None) -> None:
    root = directory()
    link = root / "current"
    tmp = root / f".current-{os.getpid()}"
    tmp.unlink(missing_ok=True)
    tmp.symlink_to(release.relative_to(root))
    os.replace(tmp, link)
    state = {"version": release.name, "installed_at": int(time.time()), "previous": previous}
    (root / "state.json").write_text(json.dumps(state))


def prune() -> None:
    versions = directory() / "versions"
    current = _current_release()
    releases = sorted((p for p in versions.iterdir() if p.is_dir() and not p.name.startswith(".")), key=lambda p: version_key(p.name))
    keep = {current} | set(releases[-KEEP_VERSIONS:])
    for p in releases:
        if p not in keep:
            shutil.rmtree(p, ignore_errors=True)


def update(http: httpx.Client | None = None) -> dict:
    http = http or httpx.Client(timeout=60, follow_redirects=True)
    before = active_version()
    release = latest_release(http)
    if not newer(release["version"], before):
        return {"result": "current", "version": before, "previous": before, "latest": release["version"]}
    target = directory() / "versions" / release["version"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if not (target / "yt_dlp" / "__init__.py").is_file():
        shutil.rmtree(target, ignore_errors=True)
        unpack(download_wheel(http, release["url"], release["sha256"]), target)
    check(target, release["version"])
    switch(target, before)
    prune()
    log.info("yt-dlp %s installed in %s (was %s)", release["version"], target, before)
    return {"result": "updated", "version": release["version"], "previous": before, "latest": release["version"]}


def restart() -> None:
    log.warning("yt-dlp changed to %s; restarting", active_version())
    for h in logging.getLogger().handlers:
        h.flush()
    os.execv(sys.executable, [sys.executable, *sys.orig_argv[1:]])


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print(json.dumps(update()))
