import logging
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from yt_dlp import version as ytdlp_version

from . import ingest, links, status, ytdlp_update
from . import search as search_module

log = logging.getLogger("jobbos.media")
RESTART_CHECK_S = 30.0


class InFlight:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.count = 0

    def __enter__(self) -> None:
        with self.lock:
            self.count += 1

    def __exit__(self, *_: object) -> None:
        with self.lock:
            self.count -= 1

    def idle(self) -> bool:
        with self.lock:
            return self.count == 0


in_flight = InFlight()


def restart_when_idle(stop: threading.Event, interval: float = RESTART_CHECK_S) -> None:
    while not stop.wait(interval):
        if ytdlp_update.changed() and in_flight.idle():
            time.sleep(1.0)
            if in_flight.idle():
                ytdlp_update.restart()


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop = threading.Event()
    threading.Thread(target=restart_when_idle, args=(stop,), daemon=True, name="ytdlp-restart").start()
    yield
    stop.set()


app = FastAPI(title="Jobbos media service", lifespan=lifespan)


@app.middleware("http")
async def count_requests(request: Request, call_next):
    with in_flight:
        return await call_next(request)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "yt_dlp": ytdlp_version.__version__}


@app.get("/status")
def source_status() -> dict:
    return status.status()


@app.get("/resolve")
def resolve(provider: str = Query(pattern="^(ytmusic|youtube)$"), id: str = Query(min_length=1, max_length=512)) -> dict:
    try:
        return ingest.resolve(provider, id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"resolve failed: {e}") from e


@app.get("/search")
def search(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(20, ge=1, le=50),
    sources: str | None = Query(None, pattern="^(ytmusic|youtube|soundcloud)(,(ytmusic|youtube|soundcloud))*$"),
) -> dict:
    try:
        return {"results": search_module.search_all(q, limit, sources.split(",") if sources else None)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"search failed: {e}") from e


@app.get("/radio")
def radio(
    video_id: str = Query(pattern="^[A-Za-z0-9_-]{11}$"),
    limit: int = Query(25, ge=1, le=100),
) -> dict:
    try:
        return {"results": search_module.radio(video_id, limit)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"radio failed: {e}") from e


@app.get("/link")
def link(url: str = Query(min_length=1, max_length=2048)) -> dict:
    try:
        return links.resolve_link(url)
    except links.LinkError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"link failed: {e}") from e
