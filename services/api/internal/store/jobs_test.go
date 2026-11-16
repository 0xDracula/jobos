package store

import (
	"strings"
	"testing"
	"time"
)

func TestBackoff(t *testing.T) {
	cases := map[int32]time.Duration{1: time.Minute, 2: 10 * time.Minute, 3: time.Hour, 9: time.Hour}
	for attempt, want := range cases {
		if got := Backoff(attempt); got != want {
			t.Errorf("Backoff(%d) = %v, want %v", attempt, got, want)
		}
	}
}

func TestAssetValidate(t *testing.T) {
	sha := strings.Repeat("ab", 32)
	ok := AssetResult{SHA256: sha, Kind: "audio", Path: "audio/ab/ab/" + sha + ".m4a", Bytes: 10}
	if err := ok.Validate(); err != nil {
		t.Fatalf("valid asset rejected: %v", err)
	}
	bad := []AssetResult{
		{SHA256: "nothex", Kind: "audio", Path: "audio/no/th/nothex.m4a", Bytes: 10},
		{SHA256: sha, Kind: "audio", Path: "audio/ab/ab/../../etc/passwd", Bytes: 10},
		{SHA256: sha, Kind: "audio", Path: "audio/cd/cd/" + sha + ".m4a", Bytes: 10},
		{SHA256: sha, Kind: "audio", Path: "audio/ab/ab/" + sha + ".m4a", Bytes: 0},
	}
	for i, a := range bad {
		if err := a.Validate(); err == nil {
			t.Errorf("case %d: invalid asset accepted", i)
		}
	}
}
