import hashlib
import io
import re
import zlib

import pytest
from PIL import Image, ImageCms
from PIL.PngImagePlugin import PngInfo
from PIL.TiffImagePlugin import IFDRational

from jobbos_media import config, photos

TAKEN = "2023:07:14 18:30:00"
GPS = {
    1: "N",
    2: (IFDRational(52, 1), IFDRational(22, 1), IFDRational(1234, 100)),
    3: "E",
    4: (IFDRational(4, 1), IFDRational(53, 1), IFDRational(5678, 100)),
    28: b"ASCII\x00\x00\x00Amsterdam",
}
XMP = (
    b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    b'<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"'
    b' exif:GPSLatitude="52,22.2N" exif:GPSLongitude="4,53.9E" photoshop:City="Amsterdam"/></rdf:RDF></x:xmpmeta>'
)
SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
MIMES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def camera_exif(orientation=None, taken=TAKEN, gps=True) -> Image.Exif:
    exif = Image.Exif()
    exif[0x010F] = "Jobbos"
    exif[0x0110] = "Test Camera"
    if orientation:
        exif[0x0112] = orientation
    sub = {0x829A: IFDRational(1, 120), 0x927C: b"Apple iOS\x00\x00\x01MM Amsterdam"}
    if taken:
        sub[0x9003] = taken
    exif[0x8769] = sub
    if gps:
        exif[0x8825] = GPS
    return exif


def picture(size=(400, 300), mode="RGB") -> Image.Image:
    w, h = size
    img = Image.new(mode, size, (200, 30, 60))
    img.paste((20, 40, 160), (w // 2, 0, w, h // 2))
    img.paste((30, 160, 60), (0, h // 2, w // 2, h))
    img.paste((240, 220, 40), (w // 2, h // 2, w, h))
    return img


def encode(img: Image.Image, fmt: str = "JPEG", **params) -> bytes:
    buf = io.BytesIO()
    img.save(buf, fmt, **params)
    return buf.getvalue()


def segment(marker: int, body: bytes) -> bytes:
    return bytes([0xFF, marker]) + (len(body) + 2).to_bytes(2, "big") + body


def pixels(data: bytes) -> bytes:
    return Image.open(io.BytesIO(data)).tobytes()


def read(path) -> Image.Image:
    return Image.open(io.BytesIO(path.read_bytes()))


def png_chunks(data: bytes) -> list[tuple[bytes, bytes]]:
    out, pos = [], 8
    while pos < len(data):
        stop = pos + 12 + int.from_bytes(data[pos : pos + 4], "big")
        out.append((data[pos + 4 : pos + 8], data[pos:stop]))
        pos = stop
    return out


def riff_chunks(data: bytes) -> list[tuple[bytes, bytes]]:
    out, pos = [], 12
    while pos < len(data):
        size = int.from_bytes(data[pos + 4 : pos + 8], "little")
        out.append((data[pos : pos + 4], data[pos + 8 : pos + 8 + size]))
        pos += 8 + size + (size & 1)
    return out


@pytest.fixture
def media(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MEDIA_ROOT", tmp_path)
    (tmp_path / "uploads").mkdir()
    return tmp_path


def upload(root, data: bytes, name: str = "photo.jpg") -> dict:
    (root / "uploads" / name).write_bytes(data)
    return {"photo_id": "4a3c9a52-1b0e-4f4e-9d2b-7c1f0e5a8b21", "path": f"uploads/{name}"}


def check_asset(root, asset: dict) -> None:
    sha = asset["sha256"]
    assert re.fullmatch(r"[0-9a-f]{64}", sha)
    assert asset["path"].startswith(f"photo/{sha[:2]}/{sha[2:4]}/{sha}.")
    assert asset["path"].endswith("." + MIMES[asset["mime"]])
    assert asset["kind"] == "photo"
    data = (root / asset["path"]).read_bytes()
    assert asset["bytes"] == len(data) > 0
    assert hashlib.sha256(data).hexdigest() == sha
    assert 1 <= asset["width"] <= 20000 and 1 <= asset["height"] <= 20000
    assert asset["palette"] is None or len(asset["palette"]) <= 10
    small = read(root / (asset["path"].rsplit(".", 1)[0] + ".300.jpg"))
    assert small.format == "JPEG"
    assert max(small.size) == min(300, max(asset["width"], asset["height"]))
    assert (small.width >= small.height) == (asset["width"] >= asset["height"])


def check_result(root, got: dict) -> None:
    assert set(got) == {"original", "display", "thumb", "taken_on"}
    for name in ("original", "display", "thumb"):
        check_asset(root, got[name])
    assert got["display"]["mime"] == got["thumb"]["mime"] == "image/jpeg"
    assert got["display"]["palette"] and got["original"]["palette"] is None and got["thumb"]["palette"] is None


def near(rgb, expected, tolerance=24) -> bool:
    return all(abs(a - b) <= tolerance for a, b in zip(rgb, expected))


@pytest.mark.parametrize("params", [{}, {"progressive": True}, {"restart_marker_rows": 1}])
def test_jpeg_loses_gps_and_keeps_orientation_date_and_pixels(media, params):
    source = encode(picture((400, 300)), exif=camera_exif(orientation=6), quality=90, **params)
    assert Image.open(io.BytesIO(source)).getexif().get_ifd(0x8825) and b"Amsterdam" in source
    payload = upload(media, source)
    got = photos.process_photo(payload)
    check_result(media, got)

    kept = (media / payload["path"]).read_bytes()
    original = (media / got["original"]["path"]).read_bytes()
    assert kept == original
    exif = Image.open(io.BytesIO(original)).getexif()
    assert 0x8825 not in exif and exif.get_ifd(0x8825) == {}
    assert b"Amsterdam" not in original
    assert exif[0x0112] == 6 and exif[0x010F] == "Jobbos" and exif[0x0110] == "Test Camera"
    assert exif.get_ifd(0x8769)[0x9003] == TAKEN and 0x927C not in exif.get_ifd(0x8769)
    assert pixels(original) == pixels(source)
    assert got["taken_on"] == "2023-07-14"

    assert (got["original"]["width"], got["original"]["height"]) == (300, 400)
    display = read(media / got["display"]["path"])
    assert display.size == (300, 400) == (got["display"]["width"], got["display"]["height"])
    assert "exif" not in display.info and "xmp" not in display.info
    assert display.info.get("progressive") == 1
    assert near(display.getpixel((20, 20)), (30, 160, 60))
    assert near(display.getpixel((280, 20)), (200, 30, 60))


def test_jpeg_drops_xmp_iptc_vendor_segments_comments_and_trailing_data(media):
    jpeg = encode(picture(), exif=camera_exif(), xmp=XMP, icc_profile=SRGB)
    extra = (
        segment(0xED, b"Photoshop 3.0\x008BIM\x04\x04 City Amsterdam")
        + segment(0xE6, b"GoPro\x00GPS5 Amsterdam")
        + segment(0xEB, b"JP\x00\x00jumb c2pa Amsterdam")
        + segment(0xFE, b"Amsterdam")
    )
    source = jpeg[:2] + extra + jpeg[2:] + b"\x00\x00\x00\x18ftypmp42 motion photo Amsterdam"
    payload = upload(media, source)
    got = photos.process_photo(payload)
    check_result(media, got)

    original = (media / got["original"]["path"]).read_bytes()
    assert (media / payload["path"]).read_bytes() == original
    for marker in (b"http://ns.adobe.com/xap/1.0/", b"GPSLatitude", b"Amsterdam", b"Photoshop", b"GoPro", b"jumb", b"ftyp"):
        assert marker in source and marker not in original
    assert original.endswith(b"\xff\xd9")
    assert pixels(original) == pixels(source)
    img = Image.open(io.BytesIO(original))
    assert img.info["icc_profile"] == SRGB and "xmp" not in img.info
    for name in ("display", "thumb"):
        assert read(media / got[name]["path"]).info["icc_profile"] == SRGB


def test_mpo_keeps_only_the_first_image(media):
    first = picture()
    source = encode(first, "MPO", save_all=True, append_images=[picture().rotate(90)], exif=camera_exif())
    assert Image.open(io.BytesIO(source)).format == "MPO"
    got = photos.process_photo(upload(media, source))
    check_result(media, got)
    original = (media / got["original"]["path"]).read_bytes()
    assert Image.open(io.BytesIO(original)).format == "JPEG"
    assert b"MPF\x00" not in original and original.endswith(b"\xff\xd9")
    assert original.count(b"\xff\xd8") == 1
    assert pixels(original) == pixels(source)


def test_cmyk_jpeg_keeps_its_adobe_segment(media):
    source = encode(picture().convert("CMYK"), exif=camera_exif())
    got = photos.process_photo(upload(media, source))
    check_result(media, got)
    original = (media / got["original"]["path"]).read_bytes()
    assert b"Adobe" in original and pixels(original) == pixels(source)
    assert near(read(media / got["display"]["path"]).getpixel((20, 20)), (200, 30, 60), 40)


@pytest.mark.parametrize(
    ("size", "orientation", "original", "display", "thumb"),
    [
        ((3000, 2000), None, (3000, 2000), (2048, 1365), (640, 427)),
        ((1000, 3000), None, (1000, 3000), (683, 2048), (213, 640)),
        ((4200, 2800), 6, (2800, 4200), (1365, 2048), (427, 640)),
        ((500, 400), None, (500, 400), (500, 400), (500, 400)),
    ],
)
def test_display_and_thumb_sizes(media, size, orientation, original, display, thumb):
    got = photos.process_photo(upload(media, encode(picture(size), exif=camera_exif(orientation, taken=None))))
    check_result(media, got)
    assert (got["original"]["width"], got["original"]["height"]) == original
    assert read(media / got["display"]["path"]).size == display == (got["display"]["width"], got["display"]["height"])
    assert read(media / got["thumb"]["path"]).size == thumb == (got["thumb"]["width"], got["thumb"]["height"])
    assert got["taken_on"] is None


def test_png_loses_text_and_location_and_keeps_other_chunks(media):
    info = PngInfo()
    info.add_itxt("XML:com.adobe.xmp", XMP.decode())
    info.add_text("Comment", "Amsterdam")
    info.add_text("Raw profile type exif", "Amsterdam", zip=True)
    exif = camera_exif(orientation=8)
    exif[0x0132] = "2023:07:15 09:00:00"
    source = encode(picture(), "PNG", pnginfo=info, exif=exif, dpi=(144, 144))
    assert {b"iTXt", b"tEXt", b"zTXt", b"eXIf", b"pHYs"} <= {kind for kind, _ in png_chunks(source)}
    payload = upload(media, source, "photo.png")
    got = photos.process_photo(payload)
    check_result(media, got)

    original = (media / got["original"]["path"]).read_bytes()
    assert (media / payload["path"]).read_bytes() == original
    kinds = [kind for kind, _ in png_chunks(original)]
    assert not {b"iTXt", b"tEXt", b"zTXt"} & set(kinds)
    assert b"Amsterdam" not in original
    assert [c for k, c in png_chunks(original) if k != b"eXIf"] == [
        c for k, c in png_chunks(source) if k not in (b"eXIf", b"iTXt", b"tEXt", b"zTXt")
    ]
    img = Image.open(io.BytesIO(original))
    kept = img.getexif()
    assert set(kept) == {0x0112, 0x0132, 0x8769} and kept[0x0112] == 8
    assert kept.get_ifd(0x8769) == {0x9003: TAKEN} and kept.get_ifd(0x8825) == {}
    assert img.tobytes() == pixels(source)
    assert got["taken_on"] == "2023-07-14"
    assert (got["original"]["width"], got["original"]["height"]) == (300, 400)
    assert read(media / got["display"]["path"]).size == (300, 400)


def test_png_alpha_is_flattened_onto_white(media):
    img = picture(mode="RGBA")
    img.paste((0, 0, 0, 0), (0, 0, 100, 100))
    got = photos.process_photo(upload(media, encode(img, "PNG"), "photo.png"))
    check_result(media, got)
    assert got["original"]["mime"] == "image/png"
    display = read(media / got["display"]["path"])
    assert display.mode == "RGB" and near(display.getpixel((10, 10)), (255, 255, 255), 4)
    assert near(display.getpixel((390, 290)), (240, 220, 40))


def test_sixteen_bit_greyscale_png_keeps_its_tones(media):
    grey = Image.new("I;16", (64, 64), 32768)
    got = photos.process_photo(upload(media, encode(grey, "PNG"), "photo.png"))
    check_result(media, got)
    assert near(read(media / got["display"]["path"]).getpixel((5, 5)), (128, 128, 128), 3)


def test_webp_loses_exif_location_and_xmp(media):
    source = encode(picture(), "WEBP", lossless=True, exif=camera_exif(), xmp=XMP)
    assert [kind for kind, _ in riff_chunks(source)] == [b"VP8X", b"VP8L", b"EXIF", b"XMP "]
    payload = upload(media, source, "photo.webp")
    got = photos.process_photo(payload)
    check_result(media, got)

    original = (media / got["original"]["path"]).read_bytes()
    assert (media / payload["path"]).read_bytes() == original
    chunks = riff_chunks(original)
    assert [kind for kind, _ in chunks] == [b"VP8X", b"VP8L", b"EXIF"]
    assert chunks[0][1][0] & 0x0C == 0x08
    assert int.from_bytes(original[4:8], "little") == len(original) - 8
    assert chunks[1] == riff_chunks(source)[1]
    assert b"Amsterdam" not in original and b"xmpmeta" not in original
    img = Image.open(io.BytesIO(original))
    exif = img.getexif()
    assert exif.get_ifd(0x8825) == {} and exif.get_ifd(0x8769) == {0x9003: TAKEN} and 0x010F not in exif
    assert img.tobytes() == pixels(source)
    assert got["original"]["mime"] == "image/webp" and got["taken_on"] == "2023-07-14"


def test_webp_without_dates_or_orientation_loses_its_exif_chunk(media):
    source = encode(picture(), "WEBP", quality=80, exif=camera_exif(taken=None))
    got = photos.process_photo(upload(media, source, "photo.webp"))
    original = (media / got["original"]["path"]).read_bytes()
    assert [kind for kind, _ in riff_chunks(original)] == [b"VP8X", b"VP8 "]
    assert riff_chunks(original)[0][1][0] & 0x0C == 0
    assert pixels(original) == pixels(source)


def test_simple_webp_is_unchanged(media):
    source = encode(picture(), "WEBP", quality=80)
    payload = upload(media, source, "photo.webp")
    got = photos.process_photo(payload)
    check_result(media, got)
    assert (media / payload["path"]).read_bytes() == source == (media / got["original"]["path"]).read_bytes()


def test_exif_that_cannot_be_rewritten_keeps_orientation_and_dates(media, monkeypatch):
    def fail(exif):
        raise ValueError("cannot write tag")

    monkeypatch.setattr(photos, "without_location", fail)
    got = photos.process_photo(upload(media, encode(picture(), exif=camera_exif(orientation=6))))
    exif = read(media / got["original"]["path"]).getexif()
    assert set(exif) == {0x0112, 0x8769} and exif[0x0112] == 6
    assert exif.get_ifd(0x8769) == {0x9003: TAKEN}
    assert got["taken_on"] == "2023-07-14" and got["original"]["width"] == 300


@pytest.mark.parametrize(
    ("name", "source"),
    [
        ("photo.jpg", encode(picture(), exif=camera_exif(orientation=6), xmp=XMP) + b"trailing Amsterdam"),
        ("photo.png", encode(picture(), "PNG", exif=camera_exif(orientation=3))),
        ("photo.webp", encode(picture(), "WEBP", exif=camera_exif(), xmp=XMP)),
    ],
)
def test_processing_again_gives_the_same_result(media, name, source):
    payload = upload(media, source, name)
    first = photos.process_photo(payload)
    kept = (media / payload["path"]).read_bytes()
    assert kept != source
    assert photos.process_photo(payload) == first
    assert (media / payload["path"]).read_bytes() == kept
    check_result(media, first)


@pytest.mark.parametrize("path", ["../photo.jpg", "/etc/passwd", "uploads", "uploads/../photo.jpg", "audio/ab/cd/x.m4a"])
def test_paths_outside_uploads_are_refused(media, path):
    (media / "photo.jpg").write_bytes(encode(picture()))
    with pytest.raises(ValueError, match="not an upload"):
        photos.process_photo({"photo_id": "x", "path": path})


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (encode(picture(), "GIF"), "unsupported image format GIF"),
        (encode(picture(), "BMP"), "unsupported image format BMP"),
        (b"not an image", "not a JPEG, PNG or WebP image"),
        (encode(picture(), exif=camera_exif())[:300], "unreadable image: Truncated File Read"),
        (encode(picture())[:-200], "unreadable image"),
    ],
)
def test_other_files_are_refused_and_left_alone(media, data, message):
    payload = upload(media, data, "photo.bin")
    with pytest.raises(ValueError, match=message):
        photos.process_photo(payload)
    assert (media / payload["path"]).read_bytes() == data
    assert not (media / "photo").exists()


def png_header(width: int, height: int) -> bytes:
    ihdr = width.to_bytes(4, "big") + height.to_bytes(4, "big") + bytes([8, 2, 0, 0, 0])
    return (
        photos.PNG_SIGNATURE
        + photos.png_chunk(b"IHDR", ihdr)
        + photos.png_chunk(b"IDAT", zlib.compress(b""))
        + photos.png_chunk(b"IEND", b"")
    )


@pytest.mark.parametrize(
    ("size", "message"),
    [((9000, 9000), "larger than 80 megapixels: 9000x9000"), ((25000, 100), "wider or taller than 20000 px")],
)
def test_oversized_images_are_refused(media, size, message):
    with pytest.raises(ValueError, match=message):
        photos.process_photo(upload(media, png_header(*size), "photo.png"))


def exif_with(**tags) -> Image.Exif:
    exif = Image.Exif()
    if "date_time" in tags:
        exif[0x0132] = tags["date_time"]
    if "original" in tags:
        exif[0x8769] = {0x9003: tags["original"]}
    return photos.load_exif(exif.tobytes())


def test_taken_on():
    assert photos.taken_on(exif_with(original="2023:07:14 18:30:00", date_time="2024:01:01 00:00:00")) == "2023-07-14"
    assert photos.taken_on(exif_with(date_time="2024:02:29 08:00:00")) == "2024-02-29"
    assert photos.taken_on(exif_with(original="2021-03-04 05:06:07")) == "2021-03-04"
    assert photos.taken_on(exif_with(original="0000:00:00 00:00:00", date_time="2022:05:06 07:08:09")) == "2022-05-06"
    assert photos.taken_on(exif_with(original="    :  :     :  :  ")) is None
    assert photos.taken_on(exif_with(original="1850:01:01 00:00:00")) is None
    assert photos.taken_on(exif_with(original="2023:02:30 00:00:00")) is None
    assert photos.taken_on(Image.Exif()) is None
