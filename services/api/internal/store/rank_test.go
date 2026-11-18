package store

import (
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"
)

func vec(xs ...float32) []float32 { return unit(append([]float32(nil), xs...)) }

func TestDecayAndSkipWeights(t *testing.T) {
	if got := Decay(2, 45); math.Abs(got-1) > 1e-9 {
		t.Errorf("Decay after one half-life = %v, want 1", got)
	}
	if got := Decay(2, -3); got != 2 {
		t.Errorf("Decay of a future signal = %v, want 2", got)
	}
	cases := []struct {
		pos, dur int32
		want     float64
	}{{10_000, 200_000, WeightEarlySkip}, {60_000, 200_000, WeightLateSkip}, {150_000, 200_000, 0}, {40_000, 0, 0}}
	for _, c := range cases {
		if got := SkipWeight(c.pos, c.dur); got != c.want {
			t.Errorf("SkipWeight(%d, %d) = %v, want %v", c.pos, c.dur, got, c.want)
		}
	}
}

func TestKMeansSeparatesClustersAndSilhouettePrefersTheRightK(t *testing.T) {
	var points [][]float32
	var weights []float64
	for i := 0; i < 12; i++ {
		d := float32(i%4) * 0.02
		switch i / 4 {
		case 0:
			points = append(points, vec(1, d, 0, 0))
		case 1:
			points = append(points, vec(0, 1, d, 0))
		default:
			points = append(points, vec(0, 0, d, 1))
		}
		weights = append(weights, 1)
	}
	assign := KMeans(points, weights, 3, 7)
	for g := 0; g < 3; g++ {
		for i := g * 4; i < g*4+4; i++ {
			if assign[i] != assign[g*4] {
				t.Fatalf("point %d not with its cluster: %v", i, assign)
			}
		}
	}
	if assign[0] == assign[4] || assign[4] == assign[8] || assign[0] == assign[8] {
		t.Fatalf("clusters merged: %v", assign)
	}
	three := Silhouette(points, assign, 3)
	two := Silhouette(points, KMeans(points, weights, 2, 7), 2)
	if three <= two || three < 0.8 {
		t.Errorf("silhouette k=3 %v, k=2 %v", three, two)
	}
}

func TestBuildTasteGroupsAndAffinity(t *testing.T) {
	raw := map[uuid.UUID][]float32{}
	tracks := map[uuid.UUID]MixTrack{}
	signals := map[uuid.UUID]*TrackSignal{}
	rap, rock := uuid.New(), uuid.New()
	for i := 0; i < 16; i++ {
		id := uuid.New()
		artist, v := rap, []float32{1, float32(i%4) * 0.05, 0, 0.1}
		tags := []string{"rap"}
		if i >= 8 {
			artist, v, tags = rock, []float32{0.1, 0, 1, float32(i%4) * 0.05}, []string{"rock"}
		}
		raw[id] = v
		tracks[id] = MixTrack{ID: id, ArtistIDs: []uuid.UUID{artist}, Tags: tags}
		score := 3.0
		if i >= 8 {
			score = 1
		}
		signals[id] = &TrackSignal{Score: score, Liked: true}
	}
	skipped := uuid.New()
	tracks[skipped] = MixTrack{ID: skipped, ArtistIDs: []uuid.UUID{uuid.New()}}
	signals[skipped] = &TrackSignal{Score: -4}
	taste := BuildTaste(signals, tracks, NewEmbeddings(raw), 1)
	if taste.Artists[rap] != 1 || math.Abs(taste.Artists[rock]-1.0/3) > 1e-9 {
		t.Errorf("artist affinity %v", taste.Artists)
	}
	if _, ok := taste.Artists[tracks[skipped].ArtistIDs[0]]; ok {
		t.Error("an artist with a negative sum has affinity")
	}
	if taste.Tags["rap"] != 1 {
		t.Errorf("tag affinity %v", taste.Tags)
	}
	if len(taste.Groups) < 2 || len(taste.Groups) > 4 {
		t.Fatalf("got %d groups for 16 songs", len(taste.Groups))
	}
	total := 0.0
	for _, g := range taste.Groups {
		total += g.Weight
	}
	if math.Abs(total-1) > 1e-6 {
		t.Errorf("group weights sum to %v", total)
	}
	emb := NewEmbeddings(raw)
	var rapSong uuid.UUID
	for id, m := range tracks {
		if len(m.ArtistIDs) > 0 && m.ArtistIDs[0] == rap {
			rapSong = id
			break
		}
	}
	sim, g := taste.TasteSim(emb.Get(rapSong))
	if g < 0 || sim < 0.5 {
		t.Errorf("a liked song is far from its group: %v %v", sim, g)
	}
}

func TestPercentileRanksAndTagAffinity(t *testing.T) {
	got := PercentileRanks([]float64{0.9, 0.1, 0.5})
	if got[0] != 1 || got[1] != 0 || got[2] != 0.5 {
		t.Errorf("PercentileRanks = %v", got)
	}
	if got := TagAffinity([]string{"rap", "trap", "x"}, map[string]float64{"rap": 1, "trap": 0.5}); got != 0.5 {
		t.Errorf("TagAffinity = %v, want 0.5", got)
	}
}

func TestLanguageFactor(t *testing.T) {
	cases := []struct {
		title   string
		artists []string
		tags    []string
		known   bool
		want    float64
	}{
		{"جدران", []string{"Judran"}, nil, false, 1},
		{"Awakher September", []string{"Malaaz"}, nil, false, 0.9},
		{"La Vie en rose", []string{"Someone"}, []string{"french"}, false, 0.5},
		{"Дождь", []string{"Кто-то"}, nil, false, 0.4},
		{"Дождь", []string{"Кто-то"}, nil, true, 1},
	}
	for _, c := range cases {
		if got := LanguageFactor(c.title, c.artists, c.tags, c.known); got != c.want {
			t.Errorf("LanguageFactor(%q) = %v, want %v", c.title, got, c.want)
		}
	}
}

func cand(artist string, score float64, known bool) *Cand {
	c := &Cand{Title: fmt.Sprintf("%s %v", artist, score), Artists: []string{artist}, Score: score}
	if known {
		c.Signal = &TrackSignal{Liked: true, Score: 3}
	}
	return c
}

func TestRerankKeepsTheDiscoveryShareAndSpacesArtists(t *testing.T) {
	var cands []*Cand
	for i := 0; i < 10; i++ {
		cands = append(cands, cand("Cairokee", 0.9-float64(i)*0.01, true))
		cands = append(cands, cand(fmt.Sprintf("Known %d", i), 0.5, true))
		cands = append(cands, cand(fmt.Sprintf("New %d", i), 0.4, false))
	}
	list := Rerank(cands, 10, 0.2)
	if len(list) != 10 {
		t.Fatalf("got %d songs", len(list))
	}
	fresh, cairokee := 0, 0
	for i, c := range list {
		if c.New() {
			fresh++
		}
		if c.Artists[0] == "Cairokee" {
			cairokee++
		}
		if i > 0 && c.PrimaryArtist() == list[i-1].PrimaryArtist() {
			t.Errorf("same artist twice in a row at %d", i)
		}
	}
	if fresh != 2 {
		t.Errorf("got %d new songs, want 2", fresh)
	}
	if cairokee < 1 || cairokee > MaxPerArtist {
		t.Errorf("got %d songs by one artist, want 1 to %d", cairokee, MaxPerArtist)
	}
	if list[0].New() {
		t.Error("a new song opens the mix; new songs should be spread out")
	}
}

func TestRerankCapsSongsPerArtist(t *testing.T) {
	var cands []*Cand
	for i := 0; i < 10; i++ {
		cands = append(cands, cand("Cairokee", 0.9, true), cand(fmt.Sprintf("New %d", i), 0.1, false))
	}
	n := 0
	for _, c := range Rerank(cands, 8, 0) {
		if c.Artists[0] == "Cairokee" {
			n++
		}
	}
	if n != MaxPerArtist {
		t.Errorf("got %d songs by one artist, want %d", n, MaxPerArtist)
	}
}

func TestRerankFillsWithNewSongsWhenFewAreKnown(t *testing.T) {
	cands := []*Cand{cand("A", 0.9, true)}
	for i := 0; i < 6; i++ {
		cands = append(cands, cand(fmt.Sprintf("N%d", i), 0.5, false))
	}
	if got := len(Rerank(cands, 5, 0.2)); got != 5 {
		t.Errorf("got %d songs, want 5", got)
	}
}

func TestPeriodOfAndMoodFit(t *testing.T) {
	for hour, want := range map[int]string{5: MixMorning, 11: MixMorning, 12: MixAfternoon, 17: MixEvening, 22: MixLateNight, 3: MixLateNight} {
		if got := PeriodOf(hour); got != want {
			t.Errorf("PeriodOf(%d) = %s, want %s", hour, got, want)
		}
	}
	f := func(v float32) *float32 { return &v }
	happy := MixTrack{Happy: f(0.9), Sad: f(0.1), Relaxed: f(0.3), Arousal: f(0.7), Valence: f(0.8), Energy: f(0.7)}
	sad := MixTrack{Happy: f(0.1), Sad: f(0.9), Relaxed: f(0.7), Arousal: f(0.3), Valence: f(0.2), Energy: f(0.3)}
	h1, _ := moodFit(MixHappy, happy)
	h2, _ := moodFit(MixHappy, sad)
	s1, _ := moodFit(MixSad, sad)
	if h1 <= h2 || s1 < 0.8 {
		t.Errorf("mood fit happy %v vs %v, sad %v", h1, h2, s1)
	}
	if _, ok := moodFit(MixCalm, MixTrack{}); ok {
		t.Error("a song without model scores fits a mood mix")
	}
}

func TestSoundClosenessRanksBySimilarity(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	emb := NewEmbeddings(map[uuid.UUID][]float32{a: {1, 0, 0}, b: {0.9, 0.1, 0}, c: {0, 0, 1}})
	got := SoundCloseness(emb, []uuid.UUID{a}, []MixTrack{{ID: b}, {ID: c}, {ID: uuid.New()}})
	if len(got) != 2 || got[b] <= got[c] {
		t.Errorf("SoundCloseness = %v", got)
	}
}

func TestRediscoverOffersLikedSongsUnplayedFor60Days(t *testing.T) {
	now := time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC)
	old, recent := uuid.New(), uuid.New()
	d := &RecData{Now: now, Cands: []*Cand{
		{TrackID: old, Signal: &TrackSignal{Liked: true, Plays: 4, LastEngaged: now.Add(-90 * 24 * time.Hour)}},
		{TrackID: recent, Signal: &TrackSignal{Liked: true, LastEngaged: now.Add(-10 * 24 * time.Hour)}},
	}}
	got := d.rediscover()
	if len(got) != 1 || got[0].TrackID != old {
		t.Errorf("rediscover = %v", got)
	}
}

func TestVectorTextRoundTrip(t *testing.T) {
	v := []float32{0.5, -1.25, 3e-05}
	got, err := ParseVector(VectorText(v))
	if err != nil || len(got) != 3 || got[1] != -1.25 {
		t.Errorf("round trip = %v, %v", got, err)
	}
}

func TestSongKeyIgnoresVideoSuffixes(t *testing.T) {
	if songKey("Souad Massi", "Ghir Enta (Official Video)") != songKey("souad  massi", "Ghir Enta") {
		t.Error("the same song by title and artist differs")
	}
	if songKey("Souad Massi", "Khalouni") == songKey("Souad Massi", "Ghir Enta") {
		t.Error("two songs match")
	}
}
