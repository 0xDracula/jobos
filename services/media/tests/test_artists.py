import threading

import pytest

from jobbos_media import artists, config, enrich
from jobbos_media import musicbrainz as mb


def test_pacer_spaces_calls_a_second_apart_across_threads():
    starts = []
    lock = threading.Lock()
    pacer = mb.Pacer(0.05)

    def call():
        pacer.wait()
        with lock:
            starts.append(pacer.clock())

    threads = [threading.Thread(target=call) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    starts.sort()
    assert all(b - a >= 0.049 for a, b in zip(starts, starts[1:]))


def test_pacer_waits_out_the_interval():
    now, slept = [10.0], []
    pacer = mb.Pacer(1.0, clock=lambda: now[0], sleep=lambda s: slept.append(s))
    pacer.wait()
    now[0] = 10.4
    pacer.wait()
    assert slept == [pytest.approx(0.6)]
    now[0] = 13.0
    pacer.wait()
    assert len(slept) == 1


def test_user_agent_names_the_app_and_the_contact_only_when_set(monkeypatch):
    assert mb.user_agent("https://example.org/contact") == "Jobbos/0.1.0 ( https://example.org/contact )"
    monkeypatch.setattr(config, "MUSICBRAINZ_CONTACT", None)
    assert mb.user_agent() == "Jobbos/0.1.0"


class FakeResponse:
    def __init__(self, status, body=None, headers=None):
        self.status_code, self.body, self.headers = status, body, headers or {}

    def json(self):
        return self.body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class FakeClient:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def get(self, path, params=None):
        self.calls.append((path, params))
        return self.responses.pop(0)


def test_get_waits_out_busy_answers(monkeypatch):
    client = FakeClient([FakeResponse(503, headers={"Retry-After": "2"}), FakeResponse(200, {"id": "x"})])
    slept = []
    monkeypatch.setattr(mb, "_http", lambda: client)
    monkeypatch.setattr(mb, "pacer", mb.Pacer(0))
    monkeypatch.setattr(mb.time, "sleep", slept.append)
    assert mb.get("/artist/x", {"inc": "tags"}) == {"id": "x"}
    assert slept == [2.0] and client.calls[0] == ("/artist/x", {"inc": "tags", "fmt": "json"})
    monkeypatch.setattr(mb, "_http", lambda: FakeClient([FakeResponse(404)]))
    assert mb.get("/isrc/XX") is None
    monkeypatch.setattr(mb, "_http", lambda: FakeClient([FakeResponse(503)] * mb.TRIES))
    with pytest.raises(mb.Unavailable):
        mb.get("/artist/x")


def test_tags_merge_genres_and_tags_with_positive_votes():
    entity = {
        "genres": [{"name": "Alternative Rock", "count": 3}, {"name": "indie rock", "count": 1}],
        "tags": [{"name": "alternative rock", "count": 2}, {"name": "lebanese", "count": 4}, {"name": "spam", "count": -1}],
    }
    assert mb.tags(entity) == [("lebanese", 4), ("alternative rock", 3), ("indie rock", 1)]
    assert artists.weighted(mb.tags(entity), "musicbrainz") == [
        {"name": "lebanese", "source": "musicbrainz", "weight": 1.0},
        {"name": "alternative rock", "source": "musicbrainz", "weight": 0.75},
        {"name": "indie rock", "source": "musicbrainz", "weight": 0.25},
    ]


def test_wikidata_id_from_url_relations():
    entity = {"relations": [{"type": "official homepage", "url": {"resource": "https://x.example"}},
                            {"type": "wikidata", "url": {"resource": "https://www.wikidata.org/wiki/Q2619999"}}]}
    assert mb.wikidata_id(entity) == "Q2619999"
    assert mb.wikidata_id({}) is None


def test_find_deezer_artist_by_isrc_then_by_search():
    track = {"artist": {"id": 1, "name": "Someone Else"}, "contributors": [{"id": 2, "name": "مشروع ليلى"}]}
    assert artists.find_deezer_artist("Mashrou' Leila", ["X"], [], by_isrc=lambda i: track, search=lambda a, t: []) == "2"
    hits = [{"artist": {"id": 7, "name": "Other Band"}}, {"artist": {"id": 9, "name": "El Morabba3"}}]
    assert artists.find_deezer_artist("El Morabba3", [], ["Laykoon"], by_isrc=lambda i: None, search=lambda a, t: hits) == "9"
    assert artists.find_deezer_artist("Nobody", [], ["x"], by_isrc=lambda i: None, search=lambda a, t: hits) is None


def test_find_mbid_by_isrc_credit_or_an_unambiguous_search(monkeypatch):
    monkeypatch.setattr(mb, "recordings_by_isrc", lambda isrc: [
        {"artist-credit": [{"name": "el morabba3", "artist": {"id": "m1", "name": "El Morabba3"}}]}])
    assert artists.find_mbid("El Morabba3", ["USHM81294180"], []) == "m1"
    monkeypatch.setattr(mb, "recordings_by_isrc", lambda isrc: [])
    found = [{"id": "c1", "name": "Cairokee", "score": 100, "aliases": [{"name": "Cairo-Key"}]}]
    monkeypatch.setattr(mb, "search_artists", lambda name: found)
    monkeypatch.setattr(mb, "artist_recordings", lambda mbid: [{"title": "Ana Negm"}, {"title": "Wahdy"}])
    assert artists.find_mbid("Cairokee", [], ["Wahdy"]) == "c1"
    assert artists.find_mbid("Cairokee", [], ["Another Song"]) is None
    assert artists.find_mbid("Cairokee", [], []) is None
    monkeypatch.setattr(mb, "search_artists", lambda name: found + [{"id": "c2", "name": "Cairokee", "score": 100}])
    assert artists.find_mbid("Cairokee", [], ["Wahdy"]) is None
    monkeypatch.setattr(mb, "search_artists", lambda name: [{"id": "x", "name": "Cairo Keys", "score": 90}])
    assert artists.find_mbid("Cairokee", [], ["Wahdy"]) is None

    def shedding(name):
        raise mb.Unavailable("MusicBrainz /artist: 503")

    monkeypatch.setattr(mb, "search_artists", shedding)
    assert artists.find_mbid("Cairokee", [], ["Wahdy"]) is None


def test_short_keeps_whole_sentences():
    text = "First sentence here. Second one is longer than the first. Third."
    assert artists.short(text, 30) == "First sentence here."
    assert artists.short(text, 1000) == text
    assert artists.short("Only one very long sentence without a stop", 10) == "Only one very long sentence without a stop"


def summaries(pages):
    return lambda lang, title: pages.get((lang, title))


def page(text, description="", url="https://en.wikipedia.org/wiki/X"):
    return {"text": text, "description": description, "url": url}


def test_wikipedia_bio_follows_wikidata_in_the_name_s_script():
    pages = {("ar", "مشروع ليلى"): page("مشروع ليلى فرقة روك لبنانية.", url="https://ar.wikipedia.org/wiki/x"),
             ("en", "Mashrou' Leila"): page("Mashrou' Leila was a Lebanese indie rock band.")}
    titles = lambda qid: {"en": "Mashrou' Leila", "ar": "مشروع ليلى"}
    en = artists.wikipedia_bio("Mashrou' Leila", "Q2619999", summary=summaries(pages), titles=titles)
    assert en == {"bio": "Mashrou' Leila was a Lebanese indie rock band.", "url": "https://en.wikipedia.org/wiki/X"}
    ar = artists.wikipedia_bio("مشروع ليلى", "Q2619999", summary=summaries(pages), titles=titles)
    assert ar["url"] == "https://ar.wikipedia.org/wiki/x"


def test_wikipedia_bio_by_title_needs_a_musician():
    pages = {("en", "Riff"): page("A riff is a short repeated phrase in music.", "Repeated chord progression"),
             ("en", "Riff (band)"): page("Riff is an Egyptian rock band formed in 2008.", "Egyptian band"),
             ("en", "Cairokee"): page("Cairokee is an Egyptian rock band.", "Egyptian rock band"),
             ("ar", "ماجدة الرومي"): page("ماجدة الرومي مغنية لبنانية.", "", "https://ar.wikipedia.org/wiki/m")}
    s = summaries(pages)
    assert artists.wikipedia_bio("Riff", None, summary=s) is None
    assert artists.wikipedia_bio("Cairokee", None, summary=s)["bio"] == "Cairokee is an Egyptian rock band."
    assert artists.wikipedia_bio("ماجدة الرومي", None, summary=s)["url"] == "https://ar.wikipedia.org/wiki/m"
    assert artists.wikipedia_bio("Nobody Known", None, summary=s) is None


def test_lastfm_is_not_asked_without_a_key(monkeypatch):
    monkeypatch.setattr(config, "LASTFM_API_KEY", None)
    monkeypatch.setattr(artists, "_http", lambda: pytest.fail("Last.fm asked without a key"))
    assert artists.lastfm("artist.gettoptags", artist="Cairokee") is None
    assert artists.lastfm_bio("Cairokee") is None


def test_lastfm_tags_drop_weak_and_junk_tags():
    body = {"toptags": {"tag": [{"name": "Arabic", "count": 100}, {"name": "seen live", "count": 80},
                                {"name": "rock", "count": 40}, {"name": "rare", "count": 3}]}}
    assert artists.lastfm_tags(body) == [("arabic", 100), ("rock", 40)]
    assert artists.lastfm_tags(None) == []


def test_lastfm_bio_strips_the_markup(monkeypatch):
    monkeypatch.setattr(artists, "lastfm", lambda method, **p: {"artist": {"url": "https://www.last.fm/music/Cairokee", "bio": {
        "summary": 'Cairokee is an Egyptian band &amp; more. <a href="https://www.last.fm/music/Cairokee">Read more on Last.fm</a>'}}})
    assert artists.lastfm_bio("Cairokee") == {"bio": "Cairokee is an Egyptian band & more.", "url": "https://www.last.fm/music/Cairokee"}


def test_enrich_artist_collects_everything(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MEDIA_ROOT", tmp_path)
    monkeypatch.setattr(config, "LASTFM_API_KEY", None)
    lists = {
        "/artist/9/related": [{"id": 11, "name": "Autostrad", "picture_big": "https://cdn-images.dzcdn.net/images/artist/a/500x500.jpg"},
                              {"id": 12, "name": "No Picture", "picture_big": "https://cdn-images.dzcdn.net/images/artist//500x500.jpg"}],
        "/artist/9/top": [{"id": 21, "title": "Laykoon", "duration": 250, "album": {"title": "Al Mouqawama",
                                                                                    "cover_xl": "https://cdn-images.dzcdn.net/images/cover/c/1000x1000.jpg"}}],
    }
    monkeypatch.setattr(artists, "deezer_list", lambda path, limit: lists[path])
    monkeypatch.setattr(artists, "deezer_artist", lambda i: {"picture_xl": "https://cdn-images.dzcdn.net/images/artist/p/1000x1000.jpg"})
    monkeypatch.setattr(artists, "find_mbid", lambda name, isrcs, titles: "m1")
    monkeypatch.setattr(mb, "artist", lambda mbid: {"tags": [{"name": "rock", "count": 2}],
                                                     "relations": [{"type": "wikidata", "url": {"resource": "https://www.wikidata.org/wiki/Q1"}}]})
    monkeypatch.setattr(artists, "wikipedia_bio", lambda name, qid: {"bio": "A Jordanian band.", "url": "https://en.wikipedia.org/wiki/E"}
                        if qid == "Q1" else None)
    from test_enrich import image_bytes

    got = artists.enrich_artist(
        {"artist_id": "a1", "name": "El Morabba3", "deezer_id": "9", "isrcs": [], "titles": [], "need_image": True},
        fetch=lambda url: image_bytes([((90, 20, 40), 1.0)]),
    )
    assert got["deezer_id"] == "9" and got["mbid"] == "m1"
    assert got["image"]["kind"] == "image" and got["image"]["palette"] is None
    assert got["bio"] == "A Jordanian band." and got["bio_source"] == "wikipedia"
    assert got["tags"] == [{"name": "rock", "source": "musicbrainz", "weight": 1.0}]
    assert got["related"] == [
        {"name": "Autostrad", "deezer_id": "11", "image_url": "https://cdn-images.dzcdn.net/images/artist/a/500x500.jpg"},
        {"name": "No Picture", "deezer_id": "12", "image_url": None},
    ]
    assert got["top_tracks"] == [{"title": "Laykoon", "deezer_id": "21", "album": "Al Mouqawama", "duration_ms": 250_000,
                                  "artwork_url": "https://cdn-images.dzcdn.net/images/cover/c/1000x1000.jpg"}]


def test_enrich_artist_without_deezer_or_musicbrainz(monkeypatch):
    monkeypatch.setattr(config, "LASTFM_API_KEY", None)
    monkeypatch.setattr(artists, "find_deezer_artist", lambda name, isrcs, titles: None)
    monkeypatch.setattr(artists, "find_mbid", lambda name, isrcs, titles: None)
    monkeypatch.setattr(artists, "wikipedia_bio", lambda name, qid: None)
    got = artists.enrich_artist({"artist_id": "a1", "name": "Nobody", "isrcs": ["X"], "titles": ["Y"], "need_image": True})
    assert got == {"deezer_id": None, "mbid": None, "image": None, "bio": None, "bio_source": None, "bio_url": None,
                   "tags": [], "related": [], "top_tracks": []}


def test_fetch_track_tags_uses_the_recording_with_a_similar_title(monkeypatch):
    monkeypatch.setattr(config, "LASTFM_API_KEY", None)
    monkeypatch.setattr(mb, "recordings_by_isrc", lambda isrc: [{"id": "r0", "title": "Something Else"}, {"id": "r1", "title": "Laykoon"}])
    monkeypatch.setattr(mb, "recording", lambda mbid: {"genres": [{"name": "arabic rock", "count": 1}]} if mbid == "r1" else None)
    got = artists.fetch_track_tags({"track_id": "t", "title": "Laykoon", "artists": ["El Morabba3"], "isrc": "USHM81294180"})
    assert got == {"recording_mbid": "r1", "tags": [{"name": "arabic rock", "source": "musicbrainz", "weight": 1.0}]}
    assert artists.fetch_track_tags({"track_id": "t", "title": "x", "artists": [], "isrc": None}) == {"recording_mbid": None, "tags": []}


def test_deezer_placeholder_pictures_are_dropped():
    assert enrich._real("https://cdn-images.dzcdn.net/images/artist//500x500.jpg") is None
