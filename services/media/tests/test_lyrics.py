from jobbos_media import lyrics

GHIR_ENTA = {
    "trackName": "Ghir Enta",
    "artistName": "Souad Massi",
    "albumName": "Deb",
    "duration": 306.0,
    "instrumental": False,
    "plainLyrics": "ديرني في بالك",
    "syncedLyrics": "[00:25.09] ديرني في بالك",
}


def payload(**extra):
    base = {"track_id": "t1", "title": "Ghir Enta", "artists": ["Souad Massi"], "album": "Deb", "duration_ms": 305_650}
    return {**base, **extra}


def never(*_):
    raise AssertionError("not expected")


def test_signature_match_wins():
    calls = []

    def get(title, artist, album, duration_s):
        calls.append((title, artist, album, duration_s))
        return GHIR_ENTA

    got = lyrics.fetch_lyrics(payload(), get, never, never)
    assert calls == [("Ghir Enta", "Souad Massi", "Deb", 306)]
    assert got == {
        "source": "lrclib",
        "synced_lrc": "[00:25.09] ديرني في بالك",
        "plain": "ديرني في بالك",
        "instrumental": False,
        "duration_ms": 306_000,
    }


def test_search_keeps_only_the_same_recording():
    records = [
        {**GHIR_ENTA, "trackName": "Ghir Enta (Live)", "duration": 380.0},
        {**GHIR_ENTA, "trackName": "Something Else", "artistName": "Someone"},
        {**GHIR_ENTA, "syncedLyrics": None, "duration": 305.0},
        {**GHIR_ENTA, "duration": 307.0},
    ]
    got = lyrics.fetch_lyrics(payload(), lambda *_: None, lambda *_: records, never)
    assert got["source"] == "lrclib" and got["synced_lrc"] and got["duration_ms"] == 307_000


def test_youtube_music_synced_when_lrclib_has_none():
    ytm = {"synced": [(0, "♪"), (12_470, "بتذكر آخر مرة شفتك سنتا"), (75_250, "line two")]}
    got = lyrics.fetch_lyrics(payload(external_id="RYUsdVmMxxc", file_duration_ms=212_000), lambda *_: None, lambda *_: [], lambda _: ytm)
    assert got["source"] == "ytmusic"
    assert got["synced_lrc"] == "[00:00.00] ♪\n[00:12.47] بتذكر آخر مرة شفتك سنتا\n[01:15.25] line two"
    assert got["plain"] == "بتذكر آخر مرة شفتك سنتا\nline two"
    assert got["duration_ms"] == 212_000


def test_plain_lyrics_are_the_last_fallback():
    plain_only = {**GHIR_ENTA, "syncedLyrics": None}
    got = lyrics.fetch_lyrics(payload(external_id="x"), lambda *_: plain_only, lambda *_: [], lambda _: {"plain": "from youtube"})
    assert got["source"] == "lrclib" and got["plain"] == "ديرني في بالك" and got["synced_lrc"] is None
    got = lyrics.fetch_lyrics(payload(external_id="x"), lambda *_: None, lambda *_: [], lambda _: {"plain": "from youtube"})
    assert got["source"] == "ytmusic" and got["plain"] == "from youtube"


def test_instrumental_and_nothing_found():
    instrumental = {**GHIR_ENTA, "syncedLyrics": None, "plainLyrics": None, "instrumental": True}
    got = lyrics.fetch_lyrics(payload(external_id="x"), lambda *_: instrumental, lambda *_: [], lambda _: None)
    assert got["instrumental"] is True and got["source"] == "lrclib"
    got = lyrics.fetch_lyrics(payload(external_id="x"), lambda *_: None, lambda *_: [], lambda _: None)
    assert got == {"source": None, "synced_lrc": None, "plain": None, "instrumental": False, "duration_ms": None}


def test_to_lrc():
    assert lyrics.to_lrc([(0, "a"), (61_005, "b"), (3_599_990, "")]) == "[00:00.00] a\n[01:01.00] b\n[59:59.99]"


def test_lrclib_requests_are_spaced_and_wait_out_429(monkeypatch):
    class Response:
        def __init__(self, status, retry_after=""):
            self.status_code = status
            self.headers = {"Retry-After": retry_after} if retry_after else {}

        def raise_for_status(self):
            pass

        def json(self):
            return []

    responses = [Response(429, "5"), Response(200)]

    class Client:
        def get(self, path, params):
            return responses.pop(0)

    slept = []
    clock = [100.0]
    monkeypatch.setattr(lyrics, "_lrclib", lambda: Client())
    monkeypatch.setattr(lyrics.time, "sleep", lambda s: (slept.append(s), clock.__setitem__(0, clock[0] + s)))
    monkeypatch.setattr(lyrics.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(lyrics, "_last_request", 99.5)

    assert lyrics.lrclib_search("Wahdy", "Cairokee") == []
    assert slept == [0.5, 5.0]
