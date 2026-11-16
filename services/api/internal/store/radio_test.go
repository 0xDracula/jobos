package store

import (
	"math/rand/v2"
	"testing"

	"github.com/google/uuid"
)

func f32(v float32) *float32 { return &v }

func TestPickSpacesArtistsAndExcludes(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	var cands []MixTrack
	for i := 0; i < 4; i++ {
		cands = append(cands,
			MixTrack{ID: uuid.New(), ArtistIDs: []uuid.UUID{a}, Energy: f32(0.3), Valence: f32(0.4)},
			MixTrack{ID: uuid.New(), ArtistIDs: []uuid.UUID{b}, Energy: f32(0.5), Valence: f32(0.5)},
			MixTrack{ID: uuid.New(), ArtistIDs: []uuid.UUID{c}, Energy: f32(0.9), Valence: f32(0.9)},
		)
	}
	seed := SeedFrom(cands[:1], nil)
	excluded := cands[3].ID
	got := Pick(cands, seed, Steer{}, map[uuid.UUID]bool{excluded: true}, nil, 6, rand.New(rand.NewPCG(1, 2)))
	if len(got) != 6 {
		t.Fatalf("picked %d, want 6", len(got))
	}
	artist := map[uuid.UUID]uuid.UUID{}
	for _, m := range cands {
		artist[m.ID] = m.ArtistIDs[0]
	}
	for i, id := range got {
		if id == excluded {
			t.Fatal("excluded song picked")
		}
		if i > 0 && artist[id] == artist[got[i-1]] {
			t.Fatalf("same artist twice in a row at %d", i)
		}
	}
	if artist[got[0]] != a {
		t.Errorf("first pick isn't by the seed artist")
	}
}

func TestSkipsSteerAway(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	ta := MixTrack{ID: uuid.New(), ArtistIDs: []uuid.UUID{a}}
	tb := MixTrack{ID: uuid.New(), ArtistIDs: []uuid.UUID{b}}
	seed := Seed{Artists: map[uuid.UUID]float64{a: 1, b: 1}, Tags: map[string]float64{}}
	steer := Steer{Skipped: map[uuid.UUID]int{a: 1}, Liked: map[uuid.UUID]int{}}
	if Score(ta, seed, steer) >= Score(tb, seed, steer) {
		t.Error("a skipped artist should score lower")
	}
}
