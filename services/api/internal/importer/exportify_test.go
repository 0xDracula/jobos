package importer

import (
	"strings"
	"testing"
	"time"
)

const sample = "\ufeff" + `"Track URI","Track Name","Artist URI(s)","Artist Name(s)","Album URI","Album Name","Album Artist URI(s)","Album Artist Name(s)","Album Release Date","Album Image URL","Disc Number","Track Number","Track Duration (ms)","Track Preview URL","Explicit?","Popularity","ISRC","Added By","Added At"
"spotify:track:4uLU6hMCjMI75M1A2tKUQC","غير انت","spotify:artist:1vCWHaC5f2uS3yhpwWbIA6","سعاد ماسي","spotify:album:2up3OPMp9Tb4dAKM2erWXQ","Deb","","","2003","https://i.scdn.co/image/ab67616d0000b273aaaa","1","3","305650","","false","40","fra1q0300123","spotify:user:owner","2024-05-01T12:34:56Z"
"spotify:track:0aBcDeFgHiJkLmNoPqRsTu","Wahdy, Live","spotify:artist:1aaaaaaaaaaaaaaaaaaaaa,spotify:artist:2bbbbbbbbbbbbbbbbbbbbb","Cairokee,Tyler\, The Creator","","Live at the Opera","","","2019","","1","1","294000","","true","10","","",""
"spotify:local:Artist:Album:Home+Recording:200","Home Recording","","Artist","","Album","","","","","0","0","200000","","false","0","","",""
"spotify:episode:5Xt5DXGzch68nYYamXrNxZ","An Episode","","Show","","","","","","","0","0","1000","","false","0","","",""
`

func TestParseExportify(t *testing.T) {
	tracks, skipped, err := ParseExportify(strings.NewReader(sample))
	if err != nil {
		t.Fatal(err)
	}
	if skipped != 2 {
		t.Errorf("skipped %d, want 2 (local file and episode)", skipped)
	}
	if len(tracks) != 2 {
		t.Fatalf("got %d tracks, want 2", len(tracks))
	}
	a := tracks[0]
	if a.SpotifyID != "4uLU6hMCjMI75M1A2tKUQC" || a.Title != "غير انت" || a.Album != "Deb" ||
		a.AlbumSpotifyID != "2up3OPMp9Tb4dAKM2erWXQ" || a.DurationMs != 305650 || a.ISRC != "FRA1Q0300123" || a.Explicit {
		t.Errorf("first track: %+v", a)
	}
	if len(a.Artists) != 1 || a.Artists[0].Name != "سعاد ماسي" || a.Artists[0].SpotifyID != "1vCWHaC5f2uS3yhpwWbIA6" {
		t.Errorf("first track artists: %+v", a.Artists)
	}
	if a.ArtworkURL != "https://i.scdn.co/image/ab67616d0000b273aaaa" {
		t.Errorf("artwork %q", a.ArtworkURL)
	}
	if !a.AddedAt.Equal(time.Date(2024, 5, 1, 12, 34, 56, 0, time.UTC)) {
		t.Errorf("added at %v", a.AddedAt)
	}
	b := tracks[1]
	if b.Title != "Wahdy, Live" || !b.Explicit || b.ISRC != "" || !b.AddedAt.IsZero() {
		t.Errorf("second track: %+v", b)
	}
	if len(b.Artists) != 2 || b.Artists[1].Name != "Tyler, The Creator" || b.Artists[1].SpotifyID != "2bbbbbbbbbbbbbbbbbbbbb" {
		t.Errorf("second track artists: %+v", b.Artists)
	}
}

func TestParseExportifyRejectsOtherFiles(t *testing.T) {
	for name, body := range map[string]string{
		"empty":   "",
		"columns": "Title,Artist\nWahdy,Cairokee\n",
	} {
		if _, _, err := ParseExportify(strings.NewReader(body)); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

func TestArtistIDsKeptOnlyWhenCountsMatch(t *testing.T) {
	got := artists("Tyler, The Creator", "spotify:artist:1aaaaaaaaaaaaaaaaaaaaa")
	if len(got) != 2 || got[0].SpotifyID != "" || got[1].SpotifyID != "" {
		t.Errorf("unescaped comma: %+v", got)
	}
}

func TestSpotifyPlaylistID(t *testing.T) {
	ok := map[string]string{
		"https://open.spotify.com/playlist/7yEdkXGwVhjU2OSNidRzCT?si=191ab7e6e27a441c": "7yEdkXGwVhjU2OSNidRzCT",
		"https://open.spotify.com/intl-ar/playlist/7yEdkXGwVhjU2OSNidRzCT":             "7yEdkXGwVhjU2OSNidRzCT",
		"spotify:playlist:7yEdkXGwVhjU2OSNidRzCT":                                      "7yEdkXGwVhjU2OSNidRzCT",
	}
	for link, want := range ok {
		if got, err := SpotifyPlaylistID(link); err != nil || got != want {
			t.Errorf("%s: got %q, %v", link, got, err)
		}
	}
	for _, link := range []string{"", "https://open.spotify.com/album/7yEdkXGwVhjU2OSNidRzCT", "https://evil.example/playlist/7yEdkXGwVhjU2OSNidRzCT"} {
		if _, err := SpotifyPlaylistID(link); err == nil {
			t.Errorf("%q accepted", link)
		}
	}
}
