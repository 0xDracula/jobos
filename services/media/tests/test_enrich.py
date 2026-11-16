import io

import pytest
from PIL import Image

from jobbos_media import config, enrich


def image_bytes(colors, size=(100, 100), fmt="JPEG"):
    img = Image.new("RGB", size)
    x = 0
    for rgb, share in colors:
        w = round(size[0] * share)
        img.paste(rgb, (x, 0, x + w, size[1]))
        x += w
    buf = io.BytesIO()
    img.save(buf, fmt, quality=95)
    return buf.getvalue()


def test_palette_finds_the_dominant_colors_by_weight():
    img = Image.open(io.BytesIO(image_bytes([((200, 30, 60), 0.75), ((20, 40, 160), 0.25)], fmt="PNG")))
    colors = enrich.palette(img)
    assert colors[0]["hex"] == "#c81e3c" and abs(colors[0]["weight"] - 0.75) < 0.03
    assert any(c["hex"] == "#1428a0" for c in colors)
    assert abs(sum(c["weight"] for c in colors) - 1) < 0.01
    assert enrich.palette(img) == colors


def test_lab_round_trip():
    import numpy as np

    rgb = np.array([[0.0, 0.0, 0.0], [1.0, 1.0, 1.0], [0.8, 0.1, 0.3], [0.2, 0.6, 0.9]])
    assert np.allclose(enrich.lab_to_rgb(enrich.rgb_to_lab(rgb)), rgb, atol=1e-3)
    assert abs(enrich.rgb_to_lab(rgb[1:2])[0, 0] - 100) < 0.1


def test_store_image_writes_file_thumbnail_and_palette(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MEDIA_ROOT", tmp_path)
    data = image_bytes([((240, 200, 210), 1.0)], size=(800, 800))
    got = enrich.store_image(data, "artwork", with_palette=True)
    assert got["mime"] == "image/jpeg" and got["width"] == 800 and got["kind"] == "artwork"
    assert got["path"] == f"artwork/{got['sha256'][:2]}/{got['sha256'][2:4]}/{got['sha256']}.jpg"
    assert (tmp_path / got["path"]).read_bytes() == data
    thumb = Image.open(tmp_path / got["path"].replace(".jpg", ".300.jpg"))
    assert thumb.size == (300, 300)
    assert len(got["palette"]) >= 1
    with pytest.raises(Exception):
        enrich.store_image(b"not an image", "artwork", with_palette=False)


DEEZER = {
    "id": 1,
    "title": "Aateny El Nay We Ghanny",
    "duration": 424,
    "album": {"cover_xl": "https://cdn-images.dzcdn.net/images/cover/74d4/1000x1000-000000-80-0-0.jpg"},
    "artist": {"id": 5, "name": "فيروز", "picture_xl": "https://cdn-images.dzcdn.net/images/artist/ab12/1000x1000-000000-80-0-0.jpg"},
}


def payload(**extra):
    base = {
        "track_id": "t1",
        "title": "Aateny El Nay We Ghanny",
        "artists": ["Fairuz"],
        "isrc": "QZ4UU1701668",
        "duration_ms": 424_933,
        "need_artwork": True,
        "need_artist_image": True,
    }
    return {**base, **extra}


def test_enrich_uses_deezer_by_isrc(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MEDIA_ROOT", tmp_path)
    fetched = []

    def fetch(url):
        fetched.append(url)
        return image_bytes([((10, 10, 10), 1.0)])

    got = enrich.enrich(payload(), lambda isrc: DEEZER, lambda *_: [], fetch)
    assert got["artwork_source"] == "deezer" and got["artwork"]["kind"] == "artwork"
    assert got["artist_image"]["kind"] == "image" and got["artist_image"]["palette"] is None
    assert got["deezer_artist_id"] == "5"
    assert fetched == [DEEZER["album"]["cover_xl"], DEEZER["artist"]["picture_xl"]]


def test_enrich_falls_back_to_the_original_artwork(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MEDIA_ROOT", tmp_path)
    fetched = []
    placeholder = {**DEEZER, "album": {"cover_xl": "https://cdn-images.dzcdn.net/images/cover//1000x1000.jpg"}}
    original = "https://lh3.googleusercontent.com/abc=w544-h544-l90-rj"
    got = enrich.enrich(
        payload(artwork_url=original, need_artist_image=False),
        lambda isrc: placeholder,
        lambda *_: [],
        lambda url: fetched.append(url) or image_bytes([((10, 10, 10), 1.0)]),
    )
    assert got["artwork_source"] == "original"
    assert fetched == ["https://lh3.googleusercontent.com/abc=w1200-h1200"]


def test_pick_deezer_rejects_other_songs():
    other = {**DEEZER, "title": "Something Else", "duration": 200}
    assert enrich.pick_deezer(payload(), lambda isrc: other, lambda *_: []) is None
    found = enrich.pick_deezer(payload(isrc=None), lambda isrc: None, lambda *_: [other, DEEZER])
    assert found is DEEZER
