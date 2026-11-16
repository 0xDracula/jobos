from __future__ import annotations

import logging
import os
import signal
import socket
import time

import httpx

from . import config, ingest, match

log = logging.getLogger("jobbos.worker")


def handle_download(payload: dict) -> dict:
    return ingest.ingest(payload["provider"], payload["external_id"])


def handle_match(payload: dict) -> dict:
    return match.match_track(payload)


HANDLERS = {"download_track": handle_download, "match_track": handle_match}


def describe(kind: str, payload: dict, result: dict) -> str:
    if kind == "match_track":
        best = (result.get("candidates") or [{}])[0]
        return f"{result['verdict']} {best.get('score', 0):.2f} {payload['title']!r} -> {best.get('title')!r}"
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
    with httpx.Client(base_url=config.API_URL, headers=headers, timeout=30) as http:
        log.info("worker %s polling %s", worker_id, config.API_URL)
        while not stopping:
            try:
                r = http.post("/internal/jobs/claim", json={"queue": "default", "worker": worker_id, "kinds": list(HANDLERS)})
            except httpx.HTTPError as e:
                log.warning("API unreachable: %s", e)
                time.sleep(5)
                continue
            if r.status_code == 204:
                time.sleep(2)
                continue
            r.raise_for_status()
            job = r.json()
            log.info("job %s %s started", job["id"], job["kind"])
            try:
                handler = HANDLERS[job["kind"]]
                result = handler(job["payload"])
                http.post(f"/internal/jobs/{job['id']}/complete", json={"result": result}).raise_for_status()
                log.info("job %s %s", job["id"], describe(job["kind"], job["payload"], result))
            except Exception as e:
                log.exception("job %s failed", job["id"])
                http.post(f"/internal/jobs/{job['id']}/fail", json={"error": str(e)[:2000]})


if __name__ == "__main__":
    main()
