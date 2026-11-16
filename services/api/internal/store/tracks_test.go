package store

import (
	"encoding/json"
	"testing"
)

func TestSourceTrackISRC(t *testing.T) {
	var s SourceTrack
	body := `{"provider":"soundcloud","external_id":"https://soundcloud.com/a/b","title":"Wahdy","isrc":"QMDA62664608"}`
	if err := json.Unmarshal([]byte(body), &s); err != nil || s.Validate() != nil || s.ISRC != "QMDA62664608" {
		t.Fatalf("label upload: %+v %v", s, s.Validate())
	}
	var none SourceTrack
	if err := json.Unmarshal([]byte(`{"provider":"ytmusic","external_id":"abc","title":"x","isrc":null}`), &none); err != nil || none.Validate() != nil {
		t.Fatalf("no ISRC: %v", none.Validate())
	}
	for _, bad := range []string{"qmda62664608", "QM-DA6-26-64608", "QMDA6266460"} {
		if (SourceTrack{Provider: "soundcloud", ExternalID: "x", Title: "x", ISRC: bad}).Validate() == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}
