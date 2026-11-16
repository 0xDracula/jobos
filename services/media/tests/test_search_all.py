import time

from jobbos_media import search


def result(provider, external_id, title, artist, seconds):
    return {
        "provider": provider,
        "external_id": external_id,
        "title": title,
        "artists": [{"name": artist, "id": None}],
        "album": None,
        "duration_ms": seconds * 1000 if seconds else None,
        "explicit": False,
        "thumbnail": None,
        "official": provider == "ytmusic",
    }


def test_dedupe_keeps_the_first_source_of_a_recording():
    song = result("ytmusic", "a", "Wahdy", "Cairokee", 294)
    video = result("youtube", "b", "Cairokee - Wahdy كايروكي - وحدي", "CairokeeOfficial", 294)
    lyrics = result("youtube", "c", "Cairokee - Wahdy | كايروكي - وحدي | كلمات الأغنية كاملة", "Naghma", 879)
    remix = result("soundcloud", "d", "Cairokee - Wahdy [Mo Remix]", "MO", 224)
    assert search.dedupe([song, video, lyrics, remix]) == [song, lyrics, remix]


def test_search_all_merges_sources_in_order_and_caches(monkeypatch):
    calls = []

    def source(name, results):
        def fn(query, limit):
            calls.append(name)
            return results
        return fn

    def broken(query, limit):
        raise RuntimeError("down")

    monkeypatch.setattr(search, "_cache", {})
    monkeypatch.setattr(search, "SOURCES", {
        "ytmusic": source("ytmusic", [result("ytmusic", "a", "Wahdy", "Cairokee", 294)]),
        "youtube": broken,
        "soundcloud": source("soundcloud", [result("soundcloud", "d", "Ana Negm", "Cairokee", 250)]),
    })
    got = search.search_all("Cairokee  Wahdy")
    assert [r["external_id"] for r in got] == ["a", "d"]
    assert search.search_all("cairokee wahdy") is got
    assert sorted(calls) == ["soundcloud", "ytmusic"]


def test_search_all_leaves_out_slow_sources(monkeypatch):
    def slow(query, limit):
        time.sleep(0.5)
        return [result("youtube", "late", "Late", "Someone", 100)]

    monkeypatch.setattr(search, "_cache", {})
    monkeypatch.setattr(search, "SOURCE_DEADLINE_S", 0.1)
    monkeypatch.setattr(search, "SOURCES", {"ytmusic": lambda q, n: [result("ytmusic", "a", "Wahdy", "Cairokee", 294)], "youtube": slow})
    monkeypatch.setattr(search, "PER_SOURCE", {"ytmusic": 8, "youtube": 6})
    assert [r["external_id"] for r in search.search_all("x")] == ["a"]


def test_soundcloud_previews_are_left_out(monkeypatch):
    entries = [
        {"id": "1", "url": "https://api.soundcloud.com/tracks/1", "title": "Wahdy", "uploader": "Cairokee", "duration": 30.0},
        {"id": "2", "url": "https://api.soundcloud.com/tracks/2", "title": "Wahdy (Remix)", "uploader": "MO", "duration": 223.7},
    ]
    monkeypatch.setattr(search, "_ytdlp_search", lambda q: entries)
    got = search.search_soundcloud("Wahdy")
    assert [r["external_id"] for r in got] == ["https://api.soundcloud.com/tracks/2"]
    assert got[0]["provider"] == "soundcloud" and got[0]["duration_ms"] == 223_700


def test_search_all_can_ask_some_sources(monkeypatch):
    called = []
    monkeypatch.setattr(search, "_cache", {})
    monkeypatch.setattr(search, "SOURCES", {
        "ytmusic": lambda q, n: called.append("ytmusic") or [result("ytmusic", "a", "Wahdy", "Cairokee", 294)],
        "youtube": lambda q, n: called.append("youtube") or [],
        "soundcloud": lambda q, n: called.append("soundcloud") or [result("soundcloud", "d", "Remix", "MO", 224)],
    })
    assert [r["external_id"] for r in search.search_all("x", sources=["soundcloud"])] == ["d"]
    assert called == ["soundcloud"]
