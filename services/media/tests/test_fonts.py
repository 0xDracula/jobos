import hashlib
import io

import pytest
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

from jobbos_media import config, fonts


def tiny_ttf(family: str = "Hand Test") -> bytes:
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder([".notdef", "space", "a"])
    fb.setupCharacterMap({0x20: "space", 0x61: "a"})
    pen = TTGlyphPen(None)
    pen.moveTo((100, 0))
    pen.lineTo((100, 500))
    pen.lineTo((500, 500))
    pen.lineTo((500, 0))
    pen.closePath()
    square = pen.glyph()
    fb.setupGlyf({".notdef": square, "space": TTGlyphPen(None).glyph(), "a": square})
    fb.setupHorizontalMetrics({".notdef": (600, 100), "space": (300, 0), "a": (600, 100)})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": family, "styleName": "Regular"})
    fb.setupOS2()
    fb.setupPost()
    out = io.BytesIO()
    fb.save(out)
    return out.getvalue()


@pytest.fixture
def media(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MEDIA_ROOT", tmp_path)
    (tmp_path / "uploads").mkdir()
    return tmp_path


def test_converts_a_ttf_to_woff2_stored_by_hash(media):
    (media / "uploads" / "hand.ttf").write_bytes(tiny_ttf())
    out = fonts.process_font({"user_id": "x", "path": "uploads/hand.ttf"})["font"]
    stored = (media / out["path"]).read_bytes()
    assert stored[:4] == b"wOF2"
    assert out["sha256"] == hashlib.sha256(stored).hexdigest()
    assert out["path"] == f"fonts/{out['sha256'][:2]}/{out['sha256']}.woff2"
    assert out["bytes"] == len(stored)
    assert out["family"] == "Hand Test"
    assert out["glyphs"] == 3
    assert TTFont(io.BytesIO(stored)).getBestCmap() == {0x20: "space", 0x61: "a"}


def test_the_same_font_twice_keeps_one_file(media):
    (media / "uploads" / "a.ttf").write_bytes(tiny_ttf())
    (media / "uploads" / "b.ttf").write_bytes(tiny_ttf())
    first = fonts.process_font({"path": "uploads/a.ttf"})["font"]
    second = fonts.process_font({"path": "uploads/b.ttf"})["font"]
    assert first == second
    assert len(list((media / "fonts").rglob("*.woff2"))) == 1


def test_refuses_files_that_are_not_fonts(media):
    (media / "uploads" / "x.ttf").write_bytes(b"not a font at all")
    with pytest.raises(ValueError, match="not a TrueType or OpenType font"):
        fonts.process_font({"path": "uploads/x.ttf"})


def test_refuses_paths_outside_uploads(media):
    (media / "secret.ttf").write_bytes(tiny_ttf())
    with pytest.raises(ValueError, match="not an upload"):
        fonts.process_font({"path": "uploads/../secret.ttf"})
