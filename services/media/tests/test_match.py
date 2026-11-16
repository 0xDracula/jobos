from jobbos_media import match


def song(external_id, title, artist, seconds, official=True, provider="ytmusic"):
    return {
        "provider": provider,
        "external_id": external_id,
        "title": title,
        "artists": [{"name": artist, "id": None}],
        "album": None,
        "duration_ms": seconds * 1000,
        "explicit": False,
        "thumbnail": None,
        "official": official,
    }


def searcher(results, calls=None):
    def search(query, limit):
        if calls is not None:
            calls.append(query)
        return list(results)

    return search


def payload(title, artists, seconds):
    return {"track_id": "t1", "title": title, "artists": artists, "duration_ms": seconds * 1000}


def test_picks_studio_recording_over_live():
    songs = searcher([song("live", "Wahdy (Live)", "Cairokee", 301), song("studio", "Wahdy", "Cairokee", 294)])
    videos_called = []
    result = match.match_track(payload("Wahdy", ["Cairokee"], 294), songs, searcher([], videos_called))
    assert result["verdict"] == "accepted"
    assert result["candidates"][0]["external_id"] == "studio"
    assert videos_called == []


def test_matches_across_scripts():
    songs = searcher([song("a", "غير انت", "سعاد ماسي", 305)])
    result = match.match_track(payload("Ghir Enta", ["Souad Massi"], 306), songs, searcher([]))
    assert result["verdict"] == "accepted"
    assert result["candidates"][0]["external_id"] == "a"


def test_falls_back_to_videos_from_the_artist_channel():
    songs = searcher([song("other", "Something Else", "Someone", 200)])
    videos = searcher(
        [
            song("fan", "Cairokee - Ya Abyad Ya Eswed (lyrics)", "Fan Uploads", 260, official=False, provider="youtube"),
            song("artist", "Ya Abyad Ya Eswed", "Cairokee", 241, official=False, provider="youtube"),
        ]
    )
    result = match.match_track(payload("Ya Abyad Ya Eswed", ["Cairokee"], 240), songs, videos)
    best = result["candidates"][0]
    assert best["external_id"] == "artist"
    assert best["provider"] == "youtube"
    assert best["official"] is True
    assert result["verdict"] == "accepted"


def test_unmatched_without_candidates():
    result = match.match_track(payload("Nothing", ["Nobody"], 100), searcher([]), searcher([]))
    assert result == {"verdict": "unmatched", "query": "Nothing Nobody", "candidates": []}


def test_query_drops_credits_and_edition_notes():
    assert match.query_for("Song (feat. Someone) - Remastered 2011", ["A", "B", "C"]) == "Song A B"
    assert match.query_for("Song - Live", ["A"]) == "Song - Live A"


def test_title_only_search_finds_artists_spelled_differently():
    calls = []

    def songs(query, limit):
        calls.append(query)
        if query == "Ba'aa Enta Bari'e":
            return [song("galila", "Baa Anta Bariy", "Galila", 266)]
        return [song("other", "Something Else", "Someone", 200)]

    result = match.match_track(payload("Ba'aa Enta Bari'e", ["Jalila"], 258), songs, searcher([]))
    assert calls == ["Ba'aa Enta Bari'e Jalila", "Ba'aa Enta Bari'e"]
    assert result["candidates"][0]["external_id"] == "galila"
