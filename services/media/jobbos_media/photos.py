from __future__ import annotations

import hashlib
import io
import os
import re
import uuid
import zlib
from collections.abc import Iterator
from datetime import date
from pathlib import Path

from PIL import ExifTags, Image, ImageOps, UnidentifiedImageError

from . import config, enrich

KIND = "photo"
DISPLAY_EDGE, DISPLAY_QUALITY = 2048, 85
THUMB_EDGE, THUMB_QUALITY = 640, 80
PREVIEW_QUALITY = 85
MAX_PIXELS = 80_000_000
MAX_EDGE = 20_000
FORMATS = ("JPEG", "MPO", "PNG", "WEBP")

ORIENTATION = ExifTags.Base.Orientation
DATE_TIME = ExifTags.Base.DateTime
DATE_TIME_ORIGINAL = ExifTags.Base.DateTimeOriginal
MAKER_NOTE = ExifTags.Base.MakerNote
EXIF_IFD = ExifTags.IFD.Exif
GPS_IFD = ExifTags.IFD.GPSInfo
EXIF_HEADER = b"Exif\x00\x00"

SOI, EOI, SOS, COM = 0xD8, 0xD9, 0xDA, 0xFE
APP0, APP1, APP2, APP14, APP15 = 0xE0, 0xE1, 0xE2, 0xEE, 0xEF
STANDALONE = {0x00, 0x01, SOI, *range(0xD0, 0xD8)}
ICC_HEADER = b"ICC_PROFILE\x00"
MAX_SEGMENT = 0xFFFF - 2

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_DROPPED = {b"tEXt", b"zTXt", b"iTXt", b"caBX", b"iDOT"}
WEBP_DROPPED = {b"XMP ", b"C2PA"}
VP8X_EXIF, VP8X_XMP = 0x08, 0x04

_DATE_RE = re.compile(r"\s*(\d{4})[:/-](\d{2})[:/-](\d{2})", re.ASCII)
_MARKER_RE = re.compile(rb"\xff[^\x00\xd0-\xd7]")


def upload_path(rel: str) -> Path:
    root = (config.MEDIA_ROOT / "uploads").resolve()
    path = (config.MEDIA_ROOT / rel).resolve()
    if root not in path.parents:
        raise ValueError(f"not an upload: {rel}")
    return path


def open_image(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
    except Image.DecompressionBombError as e:
        raise ValueError(f"image larger than {MAX_PIXELS // 1_000_000} megapixels") from e
    except UnidentifiedImageError as e:
        raise ValueError("not a JPEG, PNG or WebP image") from e
    except OSError as e:
        raise ValueError(f"unreadable image: {e}") from e
    if img.format not in FORMATS:
        raise ValueError(f"unsupported image format {img.format}")
    w, h = img.size
    if w * h > MAX_PIXELS:
        raise ValueError(f"image larger than {MAX_PIXELS // 1_000_000} megapixels: {w}x{h}")
    if max(w, h) > MAX_EDGE:
        raise ValueError(f"image wider or taller than {MAX_EDGE} px: {w}x{h}")
    return img


def load_exif(payload: bytes) -> Image.Exif:
    exif = Image.Exif()
    exif.load(payload)
    return exif


def exif_ifd(exif: Image.Exif) -> dict:
    return exif.get_ifd(EXIF_IFD) if EXIF_IFD in exif else {}


def orientation_and_dates(exif: Image.Exif) -> tuple:
    orientation = exif.get(ORIENTATION)
    dates = (exif_ifd(exif).get(DATE_TIME_ORIGINAL), exif.get(DATE_TIME))
    return (
        orientation if isinstance(orientation, int) else None,
        *(d if isinstance(d, (str, bytes)) else None for d in dates),
    )


def without_location(exif: Image.Exif) -> bytes:
    if GPS_IFD in exif:
        del exif[GPS_IFD]
    exif_ifd(exif).pop(MAKER_NOTE, None)
    return exif.tobytes()


def minimal_exif(
    orientation: int | None, date_time_original: str | bytes | None, date_time: str | bytes | None
) -> bytes | None:
    exif = Image.Exif()
    if orientation and 2 <= orientation <= 8:
        exif[ORIENTATION] = orientation
    if date_time:
        exif[DATE_TIME] = date_time
    if date_time_original:
        exif[EXIF_IFD] = {DATE_TIME_ORIGINAL: date_time_original}
    return exif.tobytes() if len(exif) else None


def clean_exif(payload: bytes, keep_all: bool) -> bytes | None:
    try:
        exif = load_exif(payload)
        kept = orientation_and_dates(exif)
    except Exception:
        return None
    if keep_all:
        try:
            out = without_location(exif)
            check = load_exif(out)
            if len(out) <= MAX_SEGMENT and GPS_IFD not in check and orientation_and_dates(check) == kept:
                return out
        except Exception:
            pass
    return minimal_exif(*kept)


def scan_end(data: bytes, pos: int) -> int:
    m = _MARKER_RE.search(data, pos)
    return m.start() if m else len(data)


def jpeg_segments(data: bytes) -> Iterator[tuple[int, bytes]]:
    yield SOI, data[:2]
    pos, end = 2, len(data)
    while (pos := data.find(b"\xff", pos)) != -1:
        while pos + 1 < end and data[pos + 1] == 0xFF:
            pos += 1
        if pos + 1 >= end:
            return
        marker = data[pos + 1]
        if marker == EOI:
            yield EOI, data[pos : pos + 2]
            return
        if marker in STANDALONE:
            pos += 2
            continue
        stop = pos + 2 + int.from_bytes(data[pos + 2 : pos + 4], "big")
        if stop > end or stop < pos + 4:
            return
        if marker == SOS:
            stop = scan_end(data, stop)
        yield marker, data[pos:stop]
        pos = stop


def kept_segment(marker: int, segment: bytes) -> bool:
    if marker == COM or APP0 <= marker <= APP15:
        return marker in (APP0, APP14) or (marker == APP2 and segment.startswith(ICC_HEADER, 4))
    return True


def strip_jpeg(data: bytes) -> bytes:
    out, exif_seen = [], False
    for marker, segment in jpeg_segments(data):
        if marker == APP1 and segment.startswith(EXIF_HEADER, 4):
            exif = None if exif_seen else clean_exif(segment[4:], keep_all=True)
            exif_seen = True
            if exif:
                out.append(b"\xff\xe1" + (len(exif) + 2).to_bytes(2, "big") + exif)
        elif kept_segment(marker, segment):
            out.append(segment)
    return b"".join(out)


def png_chunk(kind: bytes, body: bytes) -> bytes:
    return len(body).to_bytes(4, "big") + kind + body + zlib.crc32(kind + body).to_bytes(4, "big")


def strip_png(data: bytes) -> bytes:
    out, exif_seen = [PNG_SIGNATURE], False
    pos, end = len(PNG_SIGNATURE), len(data)
    while pos + 12 <= end:
        kind = data[pos + 4 : pos + 8]
        stop = pos + 12 + int.from_bytes(data[pos : pos + 4], "big")
        if stop > end:
            break
        if kind == b"eXIf":
            exif = None if exif_seen else clean_exif(data[pos + 8 : stop - 4], keep_all=False)
            exif_seen = True
            if exif:
                out.append(png_chunk(kind, exif[len(EXIF_HEADER) :]))
        elif kind not in PNG_DROPPED:
            out.append(data[pos:stop])
        pos = stop
        if kind == b"IEND":
            break
    return b"".join(out)


def riff_chunk(kind: bytes, body: bytes) -> bytes:
    return kind + len(body).to_bytes(4, "little") + body + b"\x00" * (len(body) & 1)


def strip_webp(data: bytes) -> bytes:
    chunks, exif_seen = [], False
    pos, end = 12, min(len(data), 8 + int.from_bytes(data[4:8], "little"))
    while pos + 8 <= end:
        kind = data[pos : pos + 4]
        size = int.from_bytes(data[pos + 4 : pos + 8], "little")
        if pos + 8 + size > end:
            break
        body = data[pos + 8 : pos + 8 + size]
        if kind == b"EXIF":
            exif = None if exif_seen else clean_exif(body, keep_all=False)
            exif_seen = True
            if exif:
                chunks.append(riff_chunk(kind, exif[len(EXIF_HEADER) :]))
        elif kind not in WEBP_DROPPED:
            chunks.append(riff_chunk(kind, body))
        pos += 8 + size + (size & 1)
    if chunks and chunks[0].startswith(b"VP8X"):
        flags = chunks[0][8] & ~(VP8X_EXIF | VP8X_XMP)
        if any(c.startswith(b"EXIF") for c in chunks):
            flags |= VP8X_EXIF
        chunks[0] = chunks[0][:8] + bytes([flags]) + chunks[0][9:]
    body = b"WEBP" + b"".join(chunks)
    return b"RIFF" + len(body).to_bytes(4, "little") + body


STRIP = {"JPEG": strip_jpeg, "MPO": strip_jpeg, "PNG": strip_png, "WEBP": strip_webp}


def taken_on(exif: Image.Exif) -> str | None:
    for value in orientation_and_dates(exif)[1:]:
        if isinstance(value, bytes):
            value = value.decode("latin-1")
        m = _DATE_RE.match(value) if value else None
        if not m:
            continue
        try:
            day = date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            continue
        if 1900 <= day.year <= 2100:
            return day.isoformat()
    return None


def fitted(size: tuple[int, int], edge: int) -> tuple[int, int]:
    w, h = size
    scale = min(1.0, edge / max(w, h))
    return max(1, round(w * scale)), max(1, round(h * scale))


def fit(img: Image.Image, edge: int) -> Image.Image:
    size = fitted(img.size, edge)
    return img if size == img.size else img.resize(size, Image.Resampling.LANCZOS)


def eight_bit(img: Image.Image) -> Image.Image:
    if img.mode.startswith("I"):
        img = img.point(lambda v: v / 256).convert("L")
    if img.mode in ("RGBA", "LA") or (img.mode in ("RGB", "L") and "transparency" not in img.info):
        return img
    return img.convert("RGBA" if img.has_transparency_data else "RGB")


def flatten(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA"):
        out = Image.new("RGB", img.size, (255, 255, 255))
        out.paste(img.convert("RGB"), (0, 0), img.getchannel("A"))
        return out
    out = img.convert("RGB")
    out.info = {}
    return out


def rgb_profile(icc: bytes | None) -> bytes | None:
    return icc if icc and icc[16:20] == b"RGB " else None


def encode_jpeg(img: Image.Image, quality: int, icc: bytes | None) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, progressive=True, optimize=True, icc_profile=icc)
    return buf.getvalue()


def write_file(path: Path, data: bytes) -> None:
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def store(
    data: bytes,
    fmt: str,
    size: tuple[int, int],
    preview: Image.Image,
    icc: bytes | None,
    palette: list[dict] | None = None,
) -> dict:
    ext, mime = enrich.FORMATS[fmt]
    sha = hashlib.sha256(data).hexdigest()
    rel = f"{KIND}/{sha[:2]}/{sha[2:4]}/{sha}.{ext}"
    dest = config.MEDIA_ROOT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        write_file(dest, data)
    small = dest.with_name(f"{sha}.{enrich.THUMB_SIZE}.jpg")
    if not small.exists():
        write_file(small, encode_jpeg(fit(preview, enrich.THUMB_SIZE), PREVIEW_QUALITY, icc))
    return {
        "sha256": sha,
        "path": rel,
        "kind": KIND,
        "mime": mime,
        "bytes": len(data),
        "width": size[0],
        "height": size[1],
        "palette": palette,
    }


def process_photo(payload: dict) -> dict:
    path = upload_path(payload["path"])
    data = path.read_bytes()
    clean = STRIP[open_image(data).format](data)
    img = open_image(clean)
    fmt, (width, height) = img.format, img.size
    img.draft(None, fitted(img.size, DISPLAY_EDGE))
    try:
        img.load()
    except (OSError, SyntaxError) as e:
        raise ValueError(f"unreadable image: {e}") from e
    exif = img.getexif()
    upright_size = (height, width) if exif.get(ORIENTATION) in (5, 6, 7, 8) else (width, height)
    taken = taken_on(exif)
    icc = rgb_profile(img.info.get("icc_profile"))
    display = flatten(ImageOps.exif_transpose(fit(eight_bit(img), DISPLAY_EDGE)))
    thumb = fit(display, THUMB_EDGE)
    if clean != data:
        write_file(path, clean)
    return {
        "original": store(clean, fmt, upright_size, display, icc),
        "display": store(
            encode_jpeg(display, DISPLAY_QUALITY, icc), "JPEG", display.size, display, icc, enrich.palette(display)
        ),
        "thumb": store(encode_jpeg(thumb, THUMB_QUALITY, icc), "JPEG", thumb.size, thumb, icc),
        "taken_on": taken,
    }
