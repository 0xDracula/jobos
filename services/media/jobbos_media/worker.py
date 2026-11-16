from __future__ import annotations

import logging
import os
import signal
import socket
import time
from pathlib import Path

import httpx

from . import config, enrich, ingest, lyrics, match

log = logging.getLogger("jobbos.worker")


class Breaker:
    def __init__(self, failures: int = 5, pause_s: float = 15 * 60, clock=time.monotonic):
        self.failures, self.pause_s, self.clock = failures, pause_s, clock
        self.in_a_row = 0
        self.until = 0.0

    def record(self, ok: bool) -> bool:
        if ok:
            self.in_a_row = 0
            return False
        self.in_a_row += 1
        if self.in_a_row < self.failures:
            return False
        self.in_a_row = 0
        self.until = self.clock() + self.pause_s
        return True

    def is_open(self) -> bool:
        return self.clock() < self.until

    def remaining_s(self) -> int:
        return max(0, int(self.until - self.clock()))


def handle_download(payload: dict) -> dict:
    return ingest.ingest(payload["provider"], payload["external_id"])


def handle_match(payload: dict) -> dict:
    return match.match_track(payload)


def handle_lyrics(payload: dict) -> dict:
    return lyrics.fetch_lyrics(payload)


def handle_enrich(payload: dict) -> dict:
    return enrich.enrich(payload)


def upload_path(rel: str) -> Path:
    root = (config.MEDIA_ROOT / "uploads").resolve()
    path = (config.MEDIA_ROOT / rel).resolve()
    if root not in path.parents:
        raise ValueError(f"not an upload: {rel}")
    return path


def cover(rel: str | None) -> dict | None:
    return enrich.store_image(upload_path(rel).read_bytes(), "artwork", with_palette=True) if rel else None


def handle_upload(payload: dict) -> dict:
    return {**ingest.ingest_file(upload_path(payload["path"])), "cover": cover(payload.get("cover_path"))}


def handle_cover(payload: dict) -> dict:
    return {"cover": cover(payload["path"])}


HANDLERS = {
    "download_track": handle_download,
    "match_track": handle_match,
    "fetch_lyrics": handle_lyrics,
    "enrich_metadata": handle_enrich,
    "process_upload": handle_upload,
    "process_cover": handle_cover,
}


def describe(kind: str, payload: dict, result: dict) -> str:
    if kind == "match_track":
        best = (result.get("candidates") or [{}])[0]
        return f"{result['verdict']} {best.get('score', 0):.2f} {payload['title']!r} -> {best.get('title')!r}"
    if kind == "fetch_lyrics":
        found = "synced" if result["synced_lrc"] else "plain" if result["plain"] else "instrumental" if result["instrumental"] else "none"
        return f"{result['source'] or '-'} {found} {payload['title']!r}"
    if kind == "enrich_metadata":
        art = result["artwork_source"] or "-"
        return f"artwork {art}, artist image {'yes' if result['artist_image'] else '-'} {payload['title']!r}"
    return "done"


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    stopping = False

    def stop(*_: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    headers = {"Authorization": f"Bearer {config.WORKER_TOKEN}"}
    downloads = Breaker()
    with httpx.Client(base_url=config.API_URL, headers=headers, timeout=30) as http:
        log.info("worker %s polling %s", worker_id, config.API_URL)
        while not stopping:
            kinds = [k for k in HANDLERS if not (k == "download_track" and downloads.is_open())]
            try:
                r = http.post(
                    "/internal/jobs/claim",
                    json={"queue": "default", "worker": worker_id, "kinds": kinds, "downloads_paused_s": downloads.remaining_s()},
                )
            except httpx.HTTPError as e:
                log.warning("API unreachable: %s", e)
                time.sleep(5)
                continue
            if r.status_code == 204:
                time.sleep(2)
                continue
            if r.status_code != 200:
                log.warning("claim failed: %s %s", r.status_code, r.text[:200])
                time.sleep(5)
                continue
            job = r.json()
            log.info("job %s %s started", job["id"], job["kind"])
            try:
                handler = HANDLERS[job["kind"]]
                result = handler(job["payload"])
                http.post(f"/internal/jobs/{job['id']}/complete", json={"result": result}).raise_for_status()
                log.info("job %s %s", job["id"], describe(job["kind"], job["payload"], result))
                if job["kind"] == "download_track":
                    downloads.record(ok=True)
            except Exception as e:
                log.exception("job %s failed", job["id"])
                try:
                    http.post(f"/internal/jobs/{job['id']}/fail", json={"error": str(e)[:2000]})
                except httpx.HTTPError:
                    log.warning("could not report job %s as failed", job["id"])
                if job["kind"] == "download_track" and downloads.record(ok=False):
                    log.warning("%d downloads failed in a row; pausing downloads for 15 minutes", downloads.failures)


if __name__ == "__main__":
    main()
