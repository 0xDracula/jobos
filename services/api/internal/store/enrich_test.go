package store

import (
	"encoding/json"
	"strings"
	"testing"
)

func image(kind, mime string, width int32) *AssetResult {
	sha := strings.Repeat("cd", 32)
	return &AssetResult{SHA256: sha, Kind: kind, Path: kind + "/cd/cd/" + sha + ".jpg", Mime: mime, Bytes: 10,
		Width: &width, Height: &width, Palette: json.RawMessage(`[{"hex":"#c81e3c","weight":0.75,"lab":[44,64,28]}]`)}
}

func TestEnrichResultValidate(t *testing.T) {
	id, badID := "1234", "12a"
	ok := []EnrichResult{
		{},
		{Artwork: image("artwork", "image/jpeg", 1000), ArtistImage: image("image", "image/jpeg", 1000), DeezerArtistID: &id},
	}
	for i, r := range ok {
		if err := r.Validate(); err != nil {
			t.Errorf("ok %d: %v", i, err)
		}
	}
	badPalette := image("artwork", "image/jpeg", 1000)
	badPalette.Palette = json.RawMessage(`{"hex":1}`)
	invalid := []EnrichResult{
		{Artwork: image("image", "image/jpeg", 1000)},
		{Artwork: image("artwork", "audio/mp4", 1000)},
		{Artwork: image("artwork", "image/jpeg", 0)},
		{Artwork: badPalette},
		{DeezerArtistID: &badID},
	}
	for i, r := range invalid {
		if err := r.Validate(); err == nil {
			t.Errorf("invalid %d accepted", i)
		}
	}
}
