package store

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestArtistEnrichResultValidate(t *testing.T) {
	ok := []string{
		`{"tags":[],"related":[],"top_tracks":[]}`,
		`{"deezer_id":"113354","mbid":"a31becdf-7b33-4409-9eb1-3f74bd72997c","bio":"Mashrou' Leila was a Lebanese band.",
		  "bio_source":"wikipedia","bio_url":"https://en.wikipedia.org/wiki/Mashrou%27_Leila",
		  "tags":[{"name":"indie rock","source":"musicbrainz","weight":1}],
		  "related":[{"name":"Autostrad","deezer_id":"11","image_url":"https://cdn-images.dzcdn.net/images/artist/a/500x500.jpg"},
		             {"name":"No Picture","deezer_id":null,"image_url":null}],
		  "top_tracks":[{"title":"Lil Watan","deezer_id":"21","album":"Raasük","duration_ms":216000,"artwork_url":null}]}`,
	}
	for i, body := range ok {
		var r ArtistEnrichResult
		if err := json.Unmarshal([]byte(body), &r); err != nil {
			t.Fatalf("ok %d: %v", i, err)
		}
		if err := r.Validate(); err != nil {
			t.Errorf("ok %d: %v", i, err)
		}
	}
	bad := []string{
		`{"deezer_id":"12a"}`,
		`{"mbid":"not-an-mbid"}`,
		`{"bio":"text"}`,
		`{"bio":"text","bio_source":"wikipedia","bio_url":"http://en.wikipedia.org/wiki/X"}`,
		`{"bio":"text","bio_source":"blog","bio_url":"https://example.org"}`,
		`{"tags":[{"name":"rock","source":"spotify","weight":1}]}`,
		`{"tags":[{"name":"rock","source":"lastfm","weight":1.5}]}`,
		`{"related":[{"name":"","deezer_id":"1"}]}`,
		`{"related":[{"name":"X","image_url":"javascript:alert(1)"}]}`,
		`{"top_tracks":[{"title":"X","duration_ms":-5}]}`,
		`{"bio":"` + strings.Repeat("x", 2001) + `","bio_source":"lastfm","bio_url":"https://www.last.fm/music/X"}`,
	}
	for i, body := range bad {
		var r ArtistEnrichResult
		if err := json.Unmarshal([]byte(body), &r); err != nil {
			t.Fatalf("bad %d: %v", i, err)
		}
		if err := r.Validate(); err == nil {
			t.Errorf("bad %d accepted: %s", i, body)
		}
	}
}
