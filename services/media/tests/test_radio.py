import warnings

from jobbos_media import app as app_module
from jobbos_media import search


def make_client():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from fastapi.testclient import TestClient
    return TestClient(app_module.app)


WATCH = {
    "tracks": [
        {"videoId": "EFMOFo7apVk", "title": "Wahdy", "length": "4:54", "videoType": "MUSIC_VIDEO_TYPE_ATV",
         "artists": [{"name": "Cairokee", "id": "UCfh4CPgJ9vgO60P6GKDDBzw"}], "album": {"name": "Supernova", "id": "MPREb_ITjrh2axWtq"},
         "thumbnail": [{"url": "https://lh3.googleusercontent.com/a=w60-h60-l90-rj"}, {"url": "https://lh3.googleusercontent.com/a=w120-h120-l90-rj"}]},
        {"videoId": "Brhya_OvTls", "title": "Nesena", "length": "3:36", "videoType": "MUSIC_VIDEO_TYPE_ATV",
         "artists": [{"name": "Cairokee", "id": "UCfh4CPgJ9vgO60P6GKDDBzw"}], "album": {"name": "Supernova", "id": "MPREb_ITjrh2axWtq"},
         "thumbnail": [{"url": "https://lh3.googleusercontent.com/b=w120-h120-l90-rj"}]},
        {"videoId": "JmUBIwK7d-E", "title": "Hob Taht El Enshaa (Official Video)", "length": "1:03:23",
         "videoType": "MUSIC_VIDEO_TYPE_OMV", "artists": [{"name": "Amir Eid", "id": None}], "album": None, "thumbnail": []},
        {"videoId": "cd8lQuz_vHw", "title": "حكمة الايام", "length": None, "videoType": "MUSIC_VIDEO_TYPE_UGC", "artists": []},
        {"title": "no video id"},
    ]
}


class FakeYTMusic:
    def __init__(self):
        self.calls = []

    def get_watch_playlist(self, videoId, radio, limit):
        self.calls.append((videoId, radio, limit))
        return WATCH


def test_radio_entries_are_search_results_without_the_seed(monkeypatch):
    fake = FakeYTMusic()
    monkeypatch.setattr(search, "_client", lambda: fake)
    got = search.radio("EFMOFo7apVk", 10)
    assert fake.calls == [("EFMOFo7apVk", True, 11)]
    assert [r["external_id"] for r in got] == ["Brhya_OvTls", "JmUBIwK7d-E", "cd8lQuz_vHw"]
    assert got[0] == {
        "provider": "ytmusic",
        "external_id": "Brhya_OvTls",
        "title": "Nesena",
        "artists": [{"name": "Cairokee", "id": "UCfh4CPgJ9vgO60P6GKDDBzw"}],
        "album": {"name": "Supernova", "id": "MPREb_ITjrh2axWtq"},
        "duration_ms": 216_000,
        "explicit": False,
        "thumbnail": "https://lh3.googleusercontent.com/b=w544-h544-l90-rj",
        "official": True,
        "isrc": None,
    }
    video, upload = got[1], got[2]
    assert (video["provider"], video["official"], video["duration_ms"], video["album"]) == ("youtube", True, 3_803_000, None)
    assert (upload["provider"], upload["official"], upload["duration_ms"], upload["artists"]) == ("youtube", False, None, [])
    assert len(search.radio("EFMOFo7apVk", 1)) == 1


def test_parse_length():
    assert search.parse_length("4:54") == 294_000
    assert search.parse_length("1:02:03") == 3_723_000
    for bad in (None, "", "4:xx", "1:2:3:4", "0:00"):
        assert search.parse_length(bad) is None


def test_radio_endpoint(monkeypatch):
    monkeypatch.setattr(search, "radio", lambda video_id, limit: [{"external_id": video_id, "limit": limit}])
    client = make_client()
    r = client.get("/radio", params={"video_id": "EFMOFo7apVk", "limit": 5})
    assert r.status_code == 200 and r.json() == {"results": [{"external_id": "EFMOFo7apVk", "limit": 5}]}
    assert client.get("/radio", params={"video_id": "not a video id"}).status_code == 422

    def broken(video_id, limit):
        raise RuntimeError("down")

    monkeypatch.setattr(search, "radio", broken)
    assert client.get("/radio", params={"video_id": "EFMOFo7apVk"}).status_code == 502
