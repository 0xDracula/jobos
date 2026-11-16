from jobbos_media.matching import (
    Recording,
    best_match,
    classify,
    duration_score,
    markers,
    normalize,
    score,
    similarity,
    skeleton,
)


def test_normalize_strips_qualifiers_and_features():
    assert normalize("Ghir Enta (Official Video)") == "ghir enta"
    assert normalize("Song Name (feat. Someone)") == "song name"
    assert normalize("Song Name ft. Someone") == "song name"


def test_normalize_unifies_arabic_forms():
    assert normalize("غَيْرُ إِنْتَ") == "غير انت"
    assert normalize("أغنية") == normalize("اغنيه")


def test_arabizi_and_arabic_share_a_skeleton():
    assert skeleton("El Morabba3") == skeleton("المربع")


def test_cross_script_names_match():
    for latin, arabic in [("El Morabba3", "المربع"), ("Cairokee", "كايروكي"), ("Souad Massi", "سعاد ماسي")]:
        assert similarity(latin, arabic) >= 0.8, (latin, arabic, similarity(latin, arabic))


def test_unrelated_names_do_not_match():
    assert similarity("Cairokee", "Souad Massi") < 0.5


def test_markers_need_a_bracket_or_separator_for_ambiguous_words():
    assert markers("Change (Live)") == {"live"}
    assert markers("Change - Live at Wembley") == {"live"}
    assert markers("Live Forever") == set()
    assert markers("Cover Me") == set()
    assert markers("Song (Slowed + Reverb)") == {"slowed"}
    assert markers("Song sped up") == {"sped up"}


def test_duration_score():
    assert duration_score(240_000, 241_000) == 1.0
    assert duration_score(240_000, 260_000) == 0.0
    assert 0 < duration_score(240_000, 248_000) < 1
    assert duration_score(None, 240_000) == 0.5


def test_official_recording_wins_and_live_is_avoided():
    source = Recording("Ghir Enta", ["Souad Massi"], 240_000)
    official = Recording("Ghir Enta", ["Souad Massi"], 241_000, official=True)
    live = Recording("Ghir Enta (Live)", ["Souad Massi"], 300_000)
    assert classify(score(source, official)) == "accepted"
    assert score(source, live) < score(source, official)
    assert classify(score(source, live)) != "accepted"
    assert best_match(source, [live, official]) == (1, score(source, official))


def test_version_markers_count_both_ways():
    live_source = Recording("Ghir Enta (Live)", ["Souad Massi"], 300_000)
    studio = Recording("Ghir Enta", ["Souad Massi"], 240_000, official=True)
    live = Recording("Ghir Enta (Live)", ["Souad Massi"], 300_000)
    assert score(live_source, live) > score(live_source, studio)


def test_arabic_title_matches_latin_upload():
    source = Recording("المربع", ["El Morabba3"], 200_000)
    candidate = Recording("El Morabba3", ["المربع"], 201_000, official=True)
    assert classify(score(source, candidate)) == "accepted"


def test_large_artwork_url():
    from jobbos_media.search import large_artwork

    url = "https://lh3.googleusercontent.com/abc=w120-h120-l90-rj"
    assert large_artwork(url) == "https://lh3.googleusercontent.com/abc=w544-h544-l90-rj"
    assert large_artwork(None) is None
