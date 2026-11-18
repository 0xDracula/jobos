from jobbos_media import start


class FakeYT:
    def get_charts(self, country):
        self.country = country
        return {"artists": {"items": [
            {"title": "Amr Diab", "browseId": "UCaA0_e02nT85T8h3xMclMvA", "thumbnails": [{"url": "https://yt3.googleusercontent.com/a=w60-h60", "width": 60}, {"url": "https://yt3.googleusercontent.com/a=w120-h120", "width": 120}]},
            {"title": "No ID"},
        ]}}

    def get_artist(self, browse_id):
        return {"name": "Souad Massi", "related": {"results": [{"title": "Fairuz", "browseId": "UCfairuz0000"}]},
                "songs": {"results": [{"title": "Ghir Enta", "videoId": "abcdefghijk", "artists": [{"name": "Souad Massi"}]}, {"title": "No video"}]}}

    def search(self, q, filter, limit):
        return [{"artist": "Souad Massi", "browseId": "UC0rgdZxE3S-dt3kjBUCxfXw", "thumbnails": []}]


def test_chart_artists_take_the_biggest_thumbnail_and_skip_items_without_ids():
    yt = FakeYT()
    assert start.chart_artists("eg", yt=yt) == [{"id": "UCaA0_e02nT85T8h3xMclMvA", "name": "Amr Diab", "image": "https://yt3.googleusercontent.com/a=w300-h300"}]
    assert yt.country == "EG"
    start.chart_artists("egypt", yt=yt)
    assert yt.country == "ZZ"


def test_artist_gives_related_artists_and_songs_with_videos():
    got = start.artist("UC0rgdZxE3S-dt3kjBUCxfXw", yt=FakeYT())
    assert got["related"] == [{"id": "UCfairuz0000", "name": "Fairuz", "image": None}]
    assert got["songs"] == [{"video_id": "abcdefghijk", "title": "Ghir Enta", "artists": ["Souad Massi"]}]


def test_search_artists_reads_the_artist_name():
    assert start.search_artists("souad", yt=FakeYT()) == [{"id": "UC0rgdZxE3S-dt3kjBUCxfXw", "name": "Souad Massi", "image": None}]
