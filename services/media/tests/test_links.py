import pytest

from jobbos_media import links

TRACK_ENTITY = {
    "id": "6kT3dyhnUy21Cya3jIKTu0",
    "name": "Feekee",
    "artists": [{"name": "Akher Zapheer", "uri": "spotify:artist:0x8vbV32RlTpfxsERAwena"}],
    "duration": 233000,
    "isExplicit": False,
    "visualIdentity": {"image": [{"url": "https://i.scdn.co/300", "maxWidth": 300}, {"url": "https://i.scdn.co/640", "maxWidth": 640}]},
}
PLAYLIST_ENTITY = {
    "id": "7yEdkXGwVhjU2OSNidRzCT",
    "name": "انسان حر",
    "trackList": [
        {"uri": "spotify:track:5ICwSVcHQYL0PWHjrU1noZ", "title": "Akherto Lahen Hazeen", "subtitle": "Akher Zapheer", "duration": 254160},
        {"uri": "spotify:track:0aBcDeFgHiJkLmNoPqRsTu", "title": "Song", "subtitle": "Zaid Khaled, Idreesi, El Waili", "duration": 200000, "isExplicit": True},
        {"uri": "spotify:local:x:y:z:1", "title": "Local", "subtitle": "Me", "duration": 1000},
    ],
}


def test_spotify_track_link():
    [t] = links.spotify_tracks("track", TRACK_ENTITY)
    assert t["spotify_id"] == "6kT3dyhnUy21Cya3jIKTu0" and t["title"] == "Feekee" and t["duration_ms"] == 233000
    assert t["artists"] == [{"name": "Akher Zapheer", "spotify_id": "0x8vbV32RlTpfxsERAwena"}]
    assert t["artwork_url"] == "https://i.scdn.co/640"


def test_spotify_playlist_link_splits_artists_and_skips_local_files():
    tracks = links.spotify_tracks("playlist", PLAYLIST_ENTITY)
    assert [t["spotify_id"] for t in tracks] == ["5ICwSVcHQYL0PWHjrU1noZ", "0aBcDeFgHiJkLmNoPqRsTu"]
    assert [a["name"] for a in tracks[1]["artists"]] == ["Zaid Khaled", "Idreesi", "El Waili"]
    assert tracks[1]["explicit"] is True and tracks[0]["album"] == ""


def test_spotify_link_patterns():
    for url, kind in [
        ("https://open.spotify.com/track/6kT3dyhnUy21Cya3jIKTu0?si=abc", "track"),
        ("https://open.spotify.com/intl-ar/album/2DbMSYmjCEbNwXk3WpXgr0", "album"),
        ("https://open.spotify.com/playlist/7yEdkXGwVhjU2OSNidRzCT", "playlist"),
    ]:
        assert links.SPOTIFY_RE.match(url).group(1) == kind
    with pytest.raises(links.LinkError, match="Unsupported link: open.spotify.com"):
        links.resolve_link("https://open.spotify.com/artist/0x8vbV32RlTpfxsERAwena")
    with pytest.raises(links.LinkError, match="Not a link"):
        links.resolve_link("Cairokee Wahdy")


def test_recordings_from_ytdlp_metadata():
    yt = {"extractor_key": "Youtube", "id": "RYUsdVmMxxc", "title": "Kifak Inta", "track": "Kifak Inta",
          "artist": "Fairuz", "duration": 212, "webpage_url": "https://www.youtube.com/watch?v=RYUsdVmMxxc"}
    r = links.recording_from_info(yt, "https://music.youtube.com/watch?v=RYUsdVmMxxc", "music.youtube.com")
    assert (r["provider"], r["external_id"], r["artists"], r["duration_ms"]) == ("ytmusic", "RYUsdVmMxxc", [{"name": "Fairuz", "id": None}], 212000)
    assert links.recording_from_info(yt, "https://youtu.be/RYUsdVmMxxc", "youtu.be")["provider"] == "youtube"
    sc = {"extractor_key": "Soundcloud", "id": "2", "title": "Wahdy (Remix)", "uploader": "MO", "duration": 223.7,
          "webpage_url": "https://soundcloud.com/mo/wahdy-remix"}
    r = links.recording_from_info(sc, "https://soundcloud.com/mo/wahdy-remix", "soundcloud.com")
    assert (r["provider"], r["external_id"]) == ("soundcloud", "https://soundcloud.com/mo/wahdy-remix")
    bc = {"extractor_key": "Bandcamp", "id": "9", "title": "Track", "artist": "Band", "webpage_url": "https://band.bandcamp.com/track/t"}
    assert links.recording_from_info(bc, "https://band.bandcamp.com/track/t", "band.bandcamp.com")["provider"] == "other"


def test_unsupported_pages_name_their_domain(monkeypatch):
    class Downloader:
        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def extract_info(self, url, download):
            raise links.yt_dlp.utils.DownloadError("ERROR: [generic] song: Unable to download webpage: HTTP Error 404")

    monkeypatch.setattr(links.yt_dlp, "YoutubeDL", Downloader)
    with pytest.raises(links.LinkError, match="Unsupported link: example.com"):
        links.resolve_link("https://example.com/song")


def test_full_width_commas_split_artists():
    sc = {"extractor_key": "Soundcloud", "id": "2", "title": "Wahdy (Remix)", "uploader": "MO，Cairokee", "webpage_url": "https://soundcloud.com/x"}
    assert [a["name"] for a in links.recording_from_info(sc, sc["webpage_url"], "soundcloud.com")["artists"]] == ["MO", "Cairokee"]


def test_youtube_playlist_ids():
    assert links.youtube_playlist_id("https://www.youtube.com/playlist?list=PL123") == "PL123"
    assert links.youtube_playlist_id("https://music.youtube.com/playlist?list=OLAK5uy_x") == "OLAK5uy_x"
    assert links.youtube_playlist_id("https://www.youtube.com/watch?v=abc&list=PL123") is None
    assert links.youtube_playlist_id("https://soundcloud.com/a/sets/b") is None


def test_youtube_playlist_entries(monkeypatch):
    class Client:
        def get_playlist(self, list_id, limit):
            return {
                "title": "Road trip",
                "trackCount": 3,
                "tracks": [
                    {"videoId": "a1", "title": "Wahdy", "artists": [{"name": "Cairokee", "id": "UC1"}], "duration_seconds": 294,
                     "album": {"name": "Supernova", "id": "MPRE1"}, "thumbnails": [{"url": "https://lh3.googleusercontent.com/x=w60-h60"}]},
                    {"videoId": None, "title": "Deleted video"},
                    {"videoId": "b2", "title": "Blocked", "isAvailable": False},
                ],
            }

    monkeypatch.setattr(links, "ytmusic_client", lambda: Client())
    got = links.resolve_link("https://music.youtube.com/playlist?list=PLabc")
    assert (got["kind"], got["provider"], got["id"], got["name"], got["truncated"]) == ("playlist", "ytmusic", "PLabc", "Road trip", False)
    [r] = got["recordings"]
    assert (r["external_id"], r["title"], r["duration_ms"], r["album"]["name"]) == ("a1", "Wahdy", 294000, "Supernova")
    assert r["thumbnail"].endswith("=w544-h544")
