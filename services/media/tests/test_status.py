from jobbos_media import status


def test_release_date_from_version():
    assert status.release_date("2026.10.26") == "2026-10-26"
    assert status.release_date("2026.10.26.232112") == "2026-10-26"
    assert status.release_date("1.12.3") is None
    assert status.release_date(None) is None


def test_cookies_file(tmp_path):
    assert status.cookies(None) == {"configured": False}
    assert status.cookies(str(tmp_path / "missing.txt")) == {"configured": True, "exists": False}
    f = tmp_path / "cookies.txt"
    f.write_text("# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tx\n.google.com\tTRUE\t/\tTRUE\t0\tNID\ty\n")
    got = status.cookies(str(f))
    assert got["exists"] and got["youtube_cookies"] == 1
