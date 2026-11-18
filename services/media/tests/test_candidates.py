import httpx
import pytest

from jobbos_media import artists, candidates, config


def test_song_key_is_the_same_across_scripts_and_video_titles():
    plain = candidates.song_key("Shim El Yasmine", ["Mashrou' Leila"])
    assert candidates.song_key("Mashrou' Leila - Shim El Yasmine (Official Video)", ["Mashrou' Leila"]) == plain
    assert candidates.song_key("Layla | ليلى", ["Judran"]) == candidates.song_key("Layla", ["Judran"])
    assert candidates.song_key("Ya Habibi", ["المربع"]) == candidates.song_key("Ya Habibi", ["El Morabba3"])
    assert candidates.song_key("Another Song", ["Mashrou' Leila"]) != plain


def test_clean_title_drops_the_artist_prefix_only_for_the_artist():
    assert candidates.clean_title("Cairokee - Ya El Midan", ["Cairokee"]) == "Ya El Midan"
    assert candidates.clean_title("Kan - Ya Ma Kan", ["Autostrad"]) == "Kan - Ya Ma Kan"


def test_seconds_reads_track_lengths():
    assert candidates.seconds("5:37") == 337_000
    assert candidates.seconds("1:02:03") == 3_723_000
    assert candidates.seconds(None) is None
    assert candidates.seconds("live") is None


class FakeYT:
    def __init__(self, tracks):
        self.tracks, self.calls = tracks, []

    def get_watch_playlist(self, videoId, radio, limit):
        self.calls.append((videoId, radio))
        return {"tracks": self.tracks}


def yt_track(vid, title, artist="Malaaz"):
    return {"videoId": vid, "title": title, "artists": [{"name": artist, "id": "UC1"}], "length": "3:00",
            "album": {"name": "Al Sad3"}, "thumbnail": [{"url": "https://i.ytimg.com/a.jpg"}]}


def test_ytmusic_radio_leaves_out_the_seed_and_ranks_by_position():
    yt = FakeYT([yt_track("seed", "Seed"), yt_track("a", "Awakher September"), yt_track("b", "Zamhareer")])
    out = candidates.ytmusic_radio([{"id": "t1", "video_id": "seed"}], 10, yt=yt)
    assert yt.calls == [("seed", True)]
    assert [c["video_id"] for c in out] == ["a", "b"]
    assert out[0]["score"] > out[1]["score"]
    assert out[0]["seed_track"] == "t1" and out[0]["duration_ms"] == 180_000
    assert out[0]["artists"] == [{"name": "Malaaz", "ytmusic_id": "UC1"}]


def test_fetch_candidates_keeps_going_when_a_source_fails_and_links_library_songs(monkeypatch):
    monkeypatch.setattr(config, "LASTFM_API_KEY", None)
    monkeypatch.setattr(config, "LISTENBRAINZ_TOKEN", None)
    monkeypatch.setattr(candidates, "deezer_similar", lambda seeds, n: [])
    yt = FakeYT([yt_track("seed", "Seed"), yt_track("a", "Shim El Yasmine", "Mashrou' Leila"), yt_track("b", "New One")])
    r = candidates.fetch_candidates({
        "tracks": [{"id": "t1", "title": "Seed", "artists": ["Malaaz"], "video_id": "seed"}],
        "library": [{"id": "lib1", "title": "Shim El Yasmine", "artists": ["Mashrou' Leila"]}],
    }, yt=yt)
    assert r["counts"] == {"ytmusic": 2, "deezer": 0, "lastfm": 0, "listenbrainz": 0}
    assert set(r["errors"]) == {"lastfm", "listenbrainz"}
    assert [c["track_id"] for c in r["candidates"]] == ["lib1", None]


def test_deezer_similar_uses_related_artists_from_the_payload(monkeypatch):
    calls = []

    def deezer_list(path, limit):
        calls.append(path)
        return [{"id": 1, "title": "Questions on My Mind", "duration": 200, "rank": 500_000,
                 "artist": {"name": "Faraj Suleiman"}, "album": {"title": "Better Than Tango"}}]

    monkeypatch.setattr(artists, "deezer_list", deezer_list)
    out = candidates.deezer_similar([{"name": "Mashrou' Leila", "related": [{"name": "Faraj Suleiman", "deezer_id": "9"}]}], 10)
    assert calls == ["/artist/9/top"]
    assert out[0]["popularity"] == 0.5 and out[0]["seed_artist"] == "Mashrou' Leila"


def test_listenbrainz_uses_the_mbid_and_skips_artists_it_cannot_find(monkeypatch):
    monkeypatch.setattr(config, "LISTENBRAINZ_TOKEN", "token")
    prompts = []

    def handler(request):
        prompt = request.url.params["prompt"]
        prompts.append(prompt)
        if "Unknown" in prompt:
            return httpx.Response(400, json={"error": "could not be looked up"})
        return httpx.Response(200, json={"payload": {"jspf": {"playlist": {"track": [
            {"title": "Tarab Dub", "creator": "Hello Psychaleppo feat. Someone", "duration": 348000,
             "identifier": ["https://musicbrainz.org/recording/00dd354c-b388-452d-b700-c801c60d943b"]}]}}}})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    out = candidates.listenbrainz_radio([{"name": "Mashrouʿ Leila", "mbid": "a31b"}, {"name": "Unknown"}], 10, http=http)
    assert prompts == ["artist:(a31b)"]
    assert out[0]["mbid"] == "00dd354c-b388-452d-b700-c801c60d943b"
    assert [a["name"] for a in out[0]["artists"]] == ["Hello Psychaleppo", "Someone"]
    with pytest.raises(RuntimeError):
        candidates.listenbrainz_radio([{"name": "Unknown"}], 10, http=http)


def test_fetch_releases_keeps_releases_since_the_date(monkeypatch):
    def deezer_list(path, limit):
        if path.endswith("/albums"):
            return [{"id": 5, "title": "New EP", "release_date": "2026-11-10", "record_type": "ep"},
                    {"id": 4, "title": "Old", "release_date": "2019-03-01", "record_type": "album"}]
        return [{"id": 51, "title": "Song", "duration": 180, "artist": {"name": "Cairokee"}}]

    monkeypatch.setattr(artists, "deezer_list", deezer_list)
    r = candidates.fetch_releases({"since": "2026-11-01", "artists": [{"id": "a1", "name": "Cairokee", "deezer_id": "1"}]})
    assert [x["title"] for x in r["releases"]] == ["New EP"]
    assert r["releases"][0]["tracks"] == [{"title": "Song", "deezer_id": "51", "artists": ["Cairokee"], "duration_ms": 180_000}]


def test_fetch_candidates_gives_lastfm_s_unfilled_share_to_youtube_music(monkeypatch):
    monkeypatch.setattr(config, "LASTFM_API_KEY", "k")
    monkeypatch.setattr(config, "LISTENBRAINZ_TOKEN", None)

    def refused(tracks, seeds, n):
        raise artists.LastfmUnavailable("Last.fm refused the API key")

    asked = {}

    def radio(seeds, n, yt=None):
        asked["n"] = n
        return []

    monkeypatch.setattr(candidates, "lastfm_similar", refused)
    monkeypatch.setattr(candidates, "ytmusic_radio", radio)
    monkeypatch.setattr(candidates, "deezer_similar", lambda seeds, n: [])
    r = candidates.fetch_candidates({"tracks": [], "artists": []})
    assert asked["n"] == candidates.LIMITS["ytmusic"] + candidates.LIMITS["lastfm"]
    assert r["errors"]["lastfm"] == "LastfmUnavailable: Last.fm refused the API key"
