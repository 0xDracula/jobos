from fastapi import FastAPI, HTTPException, Query
from yt_dlp import version as ytdlp_version

from . import ingest, links, status
from . import search as search_module

app = FastAPI(title="Jobbos media service")


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


@app.get("/link")
def link(url: str = Query(min_length=1, max_length=2048)) -> dict:
    try:
        return links.resolve_link(url)
    except links.LinkError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"link failed: {e}") from e
