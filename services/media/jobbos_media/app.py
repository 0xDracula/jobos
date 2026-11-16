from fastapi import FastAPI, HTTPException, Query
from yt_dlp import version as ytdlp_version

from . import search as search_module

app = FastAPI(title="Jobbos media service")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "yt_dlp": ytdlp_version.__version__}


@app.get("/search")
def search(q: str = Query(min_length=1, max_length=200), limit: int = Query(20, ge=1, le=50)) -> dict:
    try:
        return {"results": search_module.search_songs(q, limit)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"search failed: {e}") from e
