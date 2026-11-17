package store

import (
	"math/rand/v2"
	"testing"

	"github.com/google/uuid"
)

func TestPickBoost(t *testing.T) {
	a := uuid.New()
	seed := Seed{Artists: map[uuid.UUID]float64{a: 1}, Tags: map[string]float64{}}
	plain := MixTrack{ID: uuid.New(), ArtistIDs: []uuid.UUID{a}, Energy: f32(0.5), Valence: f32(0.5)}
	picked := plain
	picked.ID, picked.Picked = uuid.New(), true
	if Score(picked, seed, Steer{}) <= Score(plain, seed, Steer{}) {
		t.Fatal("a pick should score higher than the same song unpicked")
	}
	stranger := MixTrack{ID: uuid.New(), ArtistIDs: []uuid.UUID{uuid.New()}, Energy: f32(0.5), Valence: f32(0.5), Picked: true}
	if Score(stranger, seed, Steer{}) >= Score(plain, seed, Steer{}) {
		t.Error("a pick outranked a strong match")
	}
	first := 0
	for s := uint64(0); s < 200; s++ {
		if got := Pick([]MixTrack{plain, picked}, seed, Steer{}, nil, nil, 1, rand.New(rand.NewPCG(s, 7))); got[0] == picked.ID {
			first++
		}
	}
	if first < 140 {
		t.Errorf("the pick came first in %d of 200 sessions", first)
	}
}
