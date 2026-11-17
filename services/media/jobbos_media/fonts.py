from __future__ import annotations

import hashlib
import io
from pathlib import Path

from fontTools.ttLib import TTFont

from . import config

MAX_BYTES = 10 << 20
SFNT_VERSIONS = ("\x00\x01\x00\x00", "true", "OTTO")


def upload_path(rel: str) -> Path:
    root = (config.MEDIA_ROOT / "uploads").resolve()
    path = (config.MEDIA_ROOT / rel).resolve()
    if root not in path.parents:
        raise ValueError(f"not an upload: {rel}")
    return path


def family_name(font: TTFont) -> str:
    if "name" not in font:
        return ""
    for name_id in (16, 1, 4):
        name = font["name"].getDebugName(name_id)
        if name:
            return name.strip()
    return ""


def to_woff2(data: bytes) -> tuple[bytes, str, int]:
    try:
        font = TTFont(io.BytesIO(data), lazy=False)
    except Exception as e:
        raise ValueError(f"not a TrueType or OpenType font: {e}") from e
    if font.sfntVersion not in SFNT_VERSIONS:
        raise ValueError("not a TrueType or OpenType font")
    if not font.getBestCmap():
        raise ValueError("the font maps no characters")
    family, glyphs = family_name(font), len(font.getGlyphOrder())
    font.flavor = "woff2"
    out = io.BytesIO()
    font.save(out)
    return out.getvalue(), family, glyphs


def process_font(payload: dict) -> dict:
    src = upload_path(payload["path"])
    data = src.read_bytes()
    if len(data) > MAX_BYTES:
        raise ValueError("fonts are 10 MB at most")
    woff2, family, glyphs = to_woff2(data)
    sha = hashlib.sha256(woff2).hexdigest()
    rel = f"fonts/{sha[:2]}/{sha}.woff2"
    dest = config.MEDIA_ROOT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        tmp = dest.with_name(f"{sha}.tmp")
        tmp.write_bytes(woff2)
        tmp.replace(dest)
    return {"font": {"sha256": sha, "path": rel, "bytes": len(woff2), "family": family, "glyphs": glyphs}}
