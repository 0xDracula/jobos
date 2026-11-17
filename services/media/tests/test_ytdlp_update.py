import io
import json
import os
import subprocess
import sys
import threading
import zipfile
from pathlib import Path

import pytest

from jobbos_media import app as app_module
from jobbos_media import ytdlp_update

MEDIA_DIR = Path(__file__).resolve().parents[1]


def fake_wheel(version: str, extra: dict[str, str] | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("yt_dlp/__init__.py", "")
        z.writestr("yt_dlp/version.py", f"__version__ = {version!r}\n")
        z.writestr(f"yt_dlp-{version}.dist-info/METADATA", f"Name: yt-dlp\nVersion: {version}\n")
        for name, body in (extra or {}).items():
            z.writestr(name, body)
    return buf.getvalue()


def install(root: Path, version: str) -> Path:
    release = root / "versions" / version
    release.parent.mkdir(parents=True, exist_ok=True)
    ytdlp_update.unpack(fake_wheel(version), release)
    link = root / "current"
    link.unlink(missing_ok=True)
    link.symlink_to(release.relative_to(root))
    return release


def test_versions_compare_as_dates():
    assert ytdlp_update.newer("2026.11.15", "2026.10.26")
    assert ytdlp_update.newer("2026.10.26.232112", "2026.10.26")
    assert not ytdlp_update.newer("2026.10.26", "2026.10.26")
    assert not ytdlp_update.newer("garbage", "2026.10.26")


def test_unpack_refuses_paths_outside_the_release(tmp_path):
    with pytest.raises(RuntimeError):
        ytdlp_update.unpack(fake_wheel("2026.11.15", {"../evil.py": ""}), tmp_path / "release")
    assert not (tmp_path / "evil.py").exists() and not (tmp_path / "release").exists()


def run_import(ytdlp_dir: Path) -> str:
    code = "import jobbos_media, yt_dlp.version; print(yt_dlp.version.__version__, yt_dlp.__file__)"
    env = {**os.environ, "YTDLP_DIR": str(ytdlp_dir), "PYTHONPATH": str(MEDIA_DIR)}
    out = subprocess.run([sys.executable, "-c", code], env=env, cwd=MEDIA_DIR, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def test_a_newer_installed_release_is_imported_first(tmp_path):
    bundled = ytdlp_update.bundled_version()
    release = install(tmp_path, "2099.1.1")
    assert run_import(tmp_path) == f"2099.1.1 {release / 'yt_dlp' / '__init__.py'}"
    install(tmp_path, "2000.1.1")
    assert run_import(tmp_path).split()[0] == bundled


def test_update_installs_switches_and_prunes(tmp_path, monkeypatch):
    monkeypatch.setenv("YTDLP_DIR", str(tmp_path))
    monkeypatch.setattr(ytdlp_update, "check", lambda release, version: None)
    pypi = {"version": "2099.1.1"}
    monkeypatch.setattr(ytdlp_update, "latest_release", lambda http: {**pypi, "url": "https://files.example/w.whl", "sha256": "x"})
    monkeypatch.setattr(ytdlp_update, "download_wheel", lambda http, url, sha: fake_wheel(pypi["version"]))

    first = ytdlp_update.update(http=object())
    assert first == {"result": "updated", "version": "2099.1.1", "previous": ytdlp_update.bundled_version(), "latest": "2099.1.1"}
    assert (tmp_path / "current").resolve() == tmp_path / "versions" / "2099.1.1"
    assert json.loads((tmp_path / "state.json").read_text())["version"] == "2099.1.1"
    assert ytdlp_update.installed()["version"] == "2099.1.1"
    assert ytdlp_update.changed()
    again = ytdlp_update.update(http=object())
    assert again == {"result": "current", "version": "2099.1.1", "previous": "2099.1.1", "latest": "2099.1.1"}
    for version in ("2099.2.1", "2099.3.1"):
        pypi["version"] = version
        assert ytdlp_update.update(http=object())["previous"] != version
    assert sorted(p.name for p in (tmp_path / "versions").iterdir()) == ["2099.2.1", "2099.3.1"]


def test_download_checks_the_digest(monkeypatch):
    class Response:
        def __init__(self, body):
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def raise_for_status(self):
            pass

        def iter_bytes(self):
            yield self.body

    class Http:
        def stream(self, method, url):
            return Response(b"wheel")

    import hashlib

    assert ytdlp_update.download_wheel(Http(), "u", hashlib.sha256(b"wheel").hexdigest()) == b"wheel"
    with pytest.raises(RuntimeError):
        ytdlp_update.download_wheel(Http(), "u", "0" * 64)


def test_latest_release_picks_the_universal_wheel():
    class Http:
        def get(self, url):
            class R:
                def raise_for_status(self):
                    pass

                def json(self):
                    return {"info": {"version": "2026.11.15"}, "urls": [
                        {"packagetype": "sdist", "filename": "yt_dlp-2026.11.15.tar.gz", "url": "s", "digests": {"sha256": "a"}},
                        {"packagetype": "bdist_wheel", "filename": "yt_dlp-2026.11.15-py3-none-any.whl", "url": "w",
                         "digests": {"sha256": "b"}},
                    ]}

            return R()

    assert ytdlp_update.latest_release(Http()) == {"version": "2026.11.15", "url": "w", "sha256": "b"}


def test_media_service_restarts_only_when_idle(monkeypatch):
    restarts = []
    monkeypatch.setattr(ytdlp_update, "changed", lambda: True)
    monkeypatch.setattr(ytdlp_update, "restart", lambda: restarts.append(1))
    monkeypatch.setattr(app_module.time, "sleep", lambda s: None)
    stop = threading.Event()
    with app_module.in_flight:
        t = threading.Thread(target=app_module.restart_when_idle, args=(stop, 0.01))
        t.start()
        stop.wait(0.1)
        assert restarts == []
    stop.wait(0.1)
    stop.set()
    t.join()
    assert restarts
