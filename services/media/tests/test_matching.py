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


def test_spelling_variants_share_a_skeleton():
    for latin, arabic in [("Jalila", "جليلة"), ("Galela", "جليلة"), ("Thekra", "ذكرى"), ("Kan El Hanin", "كان الحنين"), ("Hegazy Metkal", "حجازى متقال")]:
        assert skeleton(latin) == skeleton(arabic), (latin, arabic, skeleton(latin), skeleton(arabic))


def test_bilingual_upload_titles_and_artists_match():
    source = Recording("Allemtini", ["Jalila"], 224_000)
    candidate = Recording("Allemtini - علمتينى", ["Galela - جليلة"], 224_000, official=True)
    assert classify(score(source, candidate)) == "accepted"


def test_artist_prefix_in_upload_title_counts_as_artist():
    source = Recording("Ajelk Shooq", ["Thekra"], 377_000)
    candidate = Recording("اجيلك شوق - ذكرى", ["على وتر القلب"], 377_000)
    assert classify(score(source, candidate)) == "accepted"
    source = Recording("Taxi", ["Mashrou' Leila"], 165_000)
    upload = Recording("Mashrou' Leila - Taxi", ["ARTIFACT MUSIC"], 166_000)
    other_cut = Recording("Taxi", ["Mashrou' Leila"], 128_000, official=True)
    assert score(source, upload) > score(source, other_cut)


def test_clip_of_a_song_loses_to_the_full_video():
    source = Recording("Lil Watan", ["Mashrou' Leila"], 216_000)
    clip = Recording("Lil Watan", ["Mashrou' Leila"], 53_000, official=True)
    video = Recording(
        "Mashrou' Leila - Lil Watan ( Official Music Video ) | مشروع ليلى - للوطن", ["Mashrou' Leila"], 227_000, official=True
    )
    assert score(source, video) > score(source, clip)
    assert classify(score(source, video)) == "accepted"
    assert classify(score(source, clip)) != "accepted"


def test_other_songs_by_the_artist_stay_unaccepted():
    source = Recording("Let Go", ["Ghalia Benali"], 251_000)
    assert classify(score(source, Recording("Daa Aank", ["Ghalia BenAli"], 251_000, official=True))) != "accepted"
    source = Recording("Men Andena", ["Ronza"], 195_000)
    assert classify(score(source, Recording("Men Andena", ["Randa"], 177_000, official=True))) != "accepted"


def test_same_length_song_with_another_title_is_not_accepted():
    source = Recording("Away Tab'an", ["Jalila"], 252_000)
    other = Recording("3lmteny - علمتنى", ["Galela - جليلة"], 253_000, official=True)
    assert classify(score(source, other)) != "accepted"


def test_same_title_by_another_artist_is_unmatched():
    source = Recording("Let Go", ["Ghalia Benali"], 251_000)
    other = Recording("Let Go (feat. Veronika Redd)", ["Ark Patrol"], 249_000, official=True)
    assert classify(score(source, other)) == "unmatched"


def test_v_and_p_read_as_arabic_f_and_b():
    assert skeleton("Vatareen") == skeleton("فتارين")


def test_isrc_match_adds_its_term():
    source = Recording("Wahdy", ["Cairokee"], 294_000, isrc="QMDA62664608")
    upload = Recording("Wahdy", ["Cairokee"], 294_000, official=True)
    same = Recording("Wahdy", ["Cairokee"], 294_000, official=True, isrc="qmda62664608")
    other = Recording("Wahdy", ["Cairokee"], 294_000, official=True, isrc="QMDA62664699")
    assert round(score(source, same) - score(source, upload), 4) == 0.10
    assert score(source, other) == score(source, upload)
    assert score(Recording("Wahdy", ["Cairokee"], 294_000), same) == score(source, upload)
